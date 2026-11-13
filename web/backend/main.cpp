#include <drogon/drogon.h>
#include <sqlite3.h>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <regex>
#include <stdexcept>
#include <ctime>
#include <cstdlib>

namespace fs = std::filesystem;
using Json::Value;

class Statement {
    sqlite3_stmt* stmt = nullptr;
public:
    Statement(sqlite3* db, const char* sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db));
    }
    ~Statement() { sqlite3_finalize(stmt); }
    Statement(const Statement&) = delete;
    void bind(int i, const std::string& s) {
        if (sqlite3_bind_text(stmt, i, s.c_str(), static_cast<int>(s.size()), SQLITE_TRANSIENT) != SQLITE_OK)
            throw std::runtime_error("Could not bind text");
    }
    void bind(int i, int64_t n) {
        if (sqlite3_bind_int64(stmt, i, n) != SQLITE_OK) throw std::runtime_error("Could not bind number");
    }
    bool next() {
        auto rc = sqlite3_step(stmt);
        if (rc != SQLITE_ROW && rc != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(sqlite3_db_handle(stmt)));
        return rc == SQLITE_ROW;
    }
    std::string str(int i) { return reinterpret_cast<const char*>(sqlite3_column_text(stmt, i)); }
    Json::Int64 number(int i) { return sqlite3_column_int64(stmt, i); }
};

class Store {
    struct Close { void operator()(sqlite3* p) const { sqlite3_close(p); } };
    std::unique_ptr<sqlite3, Close> db;
    std::mutex mutex;
    void exec(const char* sql) {
        if (sqlite3_exec(db.get(), sql, nullptr, nullptr, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db.get()));
    }
public:
    explicit Store(const fs::path& file) {
        sqlite3* raw = nullptr;
        auto rc = sqlite3_open(file.u8string().c_str(), &raw);
        db.reset(raw);
        if (rc != SQLITE_OK) throw std::runtime_error("Could not open study database");
        sqlite3_busy_timeout(raw, 3000);
        exec(R"SQL(
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS reading_position(
            id INTEGER PRIMARY KEY CHECK(id=1), chapter TEXT NOT NULL, paragraph TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS word_progress(
            chapter TEXT NOT NULL, lemma TEXT NOT NULL, rating TEXT NOT NULL,
            due_at INTEGER NOT NULL, streak INTEGER NOT NULL, PRIMARY KEY(chapter, lemma));
          CREATE INDEX IF NOT EXISTS word_due ON word_progress(due_at);
          CREATE TABLE IF NOT EXISTS review_history(
            id INTEGER PRIMARY KEY, attempt TEXT NOT NULL UNIQUE, chapter TEXT NOT NULL,
            lemma TEXT NOT NULL, rating TEXT NOT NULL, reviewed_at INTEGER NOT NULL);
        )SQL");
    }
    Value study() {
        std::lock_guard<std::mutex> lock(mutex);
        Value data;
        data["position"] = Json::nullValue;
        Statement p(db.get(), "SELECT chapter, paragraph FROM reading_position WHERE id=1");
        if (p.next()) {
            data["position"]["chapter"] = p.str(0);
            data["position"]["paragraph"] = p.str(1);
        }
        data["words"] = data["due"] = Value(Json::arrayValue);
        Statement words(db.get(), "SELECT chapter,lemma,rating,due_at,streak FROM word_progress ORDER BY due_at,chapter,lemma");
        const auto now = std::time(nullptr);
        int remembered = 0;
        while (words.next()) {
            Value word;
            word["chapter"] = words.str(0);
            word["lemma"] = words.str(1);
            word["rating"] = words.str(2);
            word["dueAt"] = words.number(3);
            if (words.number(4) >= 2) ++remembered;
            data["words"].append(word);
            if (words.number(3) <= now) data["due"].append(word);
        }
        Statement count(db.get(), "SELECT COUNT(*) FROM review_history");
        count.next();
        data["reviewCount"] = count.number(0);
        data["remembered"] = remembered;
        return data;
    }
    Value history() {
        std::lock_guard<std::mutex> lock(mutex);
        Statement q(db.get(), "SELECT chapter,lemma,rating,reviewed_at FROM review_history ORDER BY id DESC LIMIT 100");
        Value result(Json::arrayValue);
        while (q.next()) {
            Value row;
            row["chapter"] = q.str(0);
            row["lemma"] = q.str(1);
            row["rating"] = q.str(2);
            row["reviewedAt"] = q.number(3);
            result.append(row);
        }
        return result;
    }
    void position(const std::string& chapter, const std::string& paragraph) {
        std::lock_guard<std::mutex> lock(mutex);
        Statement q(db.get(), "INSERT INTO reading_position VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET chapter=excluded.chapter,paragraph=excluded.paragraph");
        q.bind(1, chapter); q.bind(2, paragraph); q.next();
    }
    void word(const std::string& chapter, const std::string& lemma, const std::string& rating, const std::string& attempt, int64_t now) {
        std::lock_guard<std::mutex> lock(mutex);
        exec("BEGIN IMMEDIATE");
        try {
            if (!attempt.empty()) {
                Statement event(db.get(), "INSERT INTO review_history(attempt,chapter,lemma,rating,reviewed_at) VALUES(?,?,?,?,?) ON CONFLICT(attempt) DO NOTHING");
                event.bind(1, attempt); event.bind(2, chapter); event.bind(3, lemma);
                event.bind(4, rating); event.bind(5, now); event.next();
                if (!sqlite3_changes(db.get())) { exec("COMMIT"); return; }
            }
            int streak = 0;
            int64_t due = now;
            if (!attempt.empty()) {
                Statement old(db.get(), "SELECT streak,due_at FROM word_progress WHERE chapter=? AND lemma=?");
                old.bind(1, chapter); old.bind(2, lemma);
                int64_t alreadyScheduled = 0;
                if (old.next() && rating == "known") {
                    streak = static_cast<int>(old.number(0));
                    if (old.number(1) <= now) ++streak;
                    else alreadyScheduled = old.number(1);
                } else if (rating == "known") { streak = 1; }
                due += rating == "new" ? 600 : rating == "fuzzy" ? 86400 :
                    (streak <= 1 ? 86400 : streak == 2 ? 3 * 86400 : 7 * 86400);
                if (alreadyScheduled) due = alreadyScheduled;
            } else if (rating == "known") { due += 86400; }
            Statement q(db.get(), "INSERT INTO word_progress VALUES(?,?,?,?,?) ON CONFLICT(chapter,lemma) DO UPDATE SET rating=excluded.rating,due_at=excluded.due_at,streak=excluded.streak");
            q.bind(1, chapter); q.bind(2, lemma); q.bind(3, rating); q.bind(4, due); q.bind(5, streak);
            q.next();
            exec("COMMIT");
        } catch (...) { exec("ROLLBACK"); throw; }
    }
};

std::string field(const Value& data, const char* key, const std::regex& pattern) {
    if (!data.isMember(key) || !data[key].isString() || data[key].asString().size() > 128 ||
        !std::regex_match(data[key].asString(), pattern))
        throw std::invalid_argument(std::string("Invalid field: ") + key);
    return data[key].asString();
}

template<class Char>
int run(int argc, Char** argv) try {
    const auto root = fs::weakly_canonical(fs::absolute(argc > 1 ? fs::path(argv[1]) : fs::path("site")));
    if (!fs::is_regular_file(root / "index.html")) throw std::runtime_error("Site index.html not found");
    const auto file = fs::weakly_canonical(fs::absolute(argc > 2 ? fs::path(argv[2]) : fs::path("var/study.sqlite")));
    const auto relative = file.lexically_relative(root);
    if (!relative.empty() && *relative.begin() != "..")
        throw std::runtime_error("Keep the database outside the public site directory");
    const int port = argc > 3 ? std::stoi(std::basic_string<Char>(argv[3])) : 8848;
    if (port < 1 || port > 65535) throw std::runtime_error("Invalid port");
    fs::create_directories(file.parent_path());
    Store store(file);
    auto& app = drogon::app();
    const auto* tokenEnv = std::getenv("CET4_DESKTOP_TOKEN");
    const std::string token = tokenEnv ? tokenEnv : "";
    const auto authorize = [&](const drogon::HttpRequestPtr& req, const auto& done) {
        if (token.empty() || req->getHeader("X-CET4-Token") == token) return true;
        auto res = drogon::HttpResponse::newHttpJsonResponse(Value("Desktop session required"));
        res->setStatusCode(drogon::k403Forbidden);
        done(res);
        return false;
    };
    const auto get = [&](const char* path, bool history) {
        app.registerHandler(path, [&, history](const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& done) {
            if (!authorize(req, done)) return;
            try {
                auto res = drogon::HttpResponse::newHttpJsonResponse(history ? store.history() : store.study());
                res->addHeader("Cache-Control", "no-store"); done(res);
            } catch (const std::exception& e) {
                LOG_ERROR << e.what();
                auto res = drogon::HttpResponse::newHttpJsonResponse(Value("Database error"));
                res->setStatusCode(drogon::k500InternalServerError); done(res);
            }
        }, {drogon::Get});
    };
    get("/api/study", false);
    get("/api/history", true);
    for (const std::string action : {"position", "mark", "review"}) {
        app.registerHandler("/api/" + action, [&, action](const drogon::HttpRequestPtr& req, std::function<void(const drogon::HttpResponsePtr&)>&& done) {
            if (!authorize(req, done)) return;
            try {
                auto json = req->getJsonObject();
                if (req->contentType() != drogon::CT_APPLICATION_JSON || !json || !json->isObject())
                    throw std::invalid_argument("Expected a JSON object");
                static const std::regex chapterId("ch(0[1-9]|[12][0-9]|30)"), paragraphId("p[1-9][0-9]?"),
                    wordId("[A-Za-z][A-Za-z0-9 .'/&()_-]*"), grades("new|fuzzy|known"), attemptId("[A-Za-z0-9_-]{1,100}");
                auto chapter = field(*json, "chapter", chapterId);
                if (action == "position") store.position(chapter, field(*json, "paragraph", paragraphId));
                else {
                    auto now = static_cast<int64_t>(std::time(nullptr));
                    const auto& time = (*json)["reviewedAt"];
                    if (action == "review" && !time.isNull()) {
                        if (!time.isInt64() || time.asInt64() <= 0 || time.asInt64() > now + 300)
                            throw std::invalid_argument("Invalid reviewedAt");
                        now = time.asInt64();
                    }
                    store.word(chapter, field(*json, "lemma", wordId), field(*json, "rating", grades),
                        action == "review" ? field(*json, "attempt", attemptId) : "", now);
                }
                done(drogon::HttpResponse::newHttpJsonResponse(Value(true)));
            } catch (const std::invalid_argument& e) {
                auto res = drogon::HttpResponse::newHttpJsonResponse(Value(e.what()));
                res->setStatusCode(drogon::k400BadRequest); done(res);
            } catch (const std::exception& e) {
                LOG_ERROR << e.what();
                auto res = drogon::HttpResponse::newHttpJsonResponse(Value("Database error"));
                res->setStatusCode(drogon::k500InternalServerError); done(res);
            }
        }, {drogon::Post});
    }
    std::cout << "CET4: http://127.0.0.1:" << port << "/ | " << file << std::endl;
    app.setDocumentRoot(root.u8string()).setClientMaxBodySize(8192).addListener("127.0.0.1", port).run();
    return 0;
} catch (const std::exception& e) {
    std::cerr << e.what() << '\n';
    return 1;
}

#if defined(_WIN32) && defined(_MSC_VER)
int wmain(int argc, wchar_t** argv) { return run(argc, argv); }
#else
int main(int argc, char** argv) { return run(argc, argv); }
#endif
