#include "migration.h"
#include <sqlite3.h>
#include <chrono>
#include <memory>
#include <stdexcept>
#include <thread>

namespace fs = std::filesystem;
namespace wordyarn {
namespace {
using Db = std::unique_ptr<sqlite3, decltype(&sqlite3_close)>;
Db open(const fs::path& file, int flags) {
    sqlite3* raw = nullptr;
    const auto rc = sqlite3_open_v2(file.u8string().c_str(), &raw, flags, nullptr);
    Db db(raw, sqlite3_close);
    if (rc != SQLITE_OK) throw std::runtime_error(raw ? sqlite3_errmsg(raw) : "Cannot open database");
    sqlite3_busy_timeout(raw, 1500);
    return db;
}
}
bool migrate(const fs::path& source, const fs::path& target) {
    if (fs::exists(target) || !fs::exists(source)) return false;
    if (!fs::is_regular_file(source)) throw std::runtime_error("The existing database is not a file");
    if (!target.parent_path().empty()) fs::create_directories(target.parent_path());
    auto temp = target;
    temp += L".importing";
    // The GUI holds the single-instance lock, so a leftover copy is from an
    // interrupted attempt. The source remains intact and can be read again.
    if (fs::exists(temp) && !fs::is_regular_file(temp))
        throw std::runtime_error("Database migration path is not a file");
    fs::remove(temp);
    try {
        {
            auto from = open(source, SQLITE_OPEN_READONLY);
            auto to = open(temp, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
            auto* backup = sqlite3_backup_init(to.get(), "main", from.get(), "main");
            if (!backup) throw std::runtime_error(sqlite3_errmsg(to.get()));
            int rc = SQLITE_OK;
            for (int attempt = 0; attempt < 30; ++attempt) {
                rc = sqlite3_backup_step(backup, -1);
                if (rc != SQLITE_BUSY && rc != SQLITE_LOCKED) break;
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            const auto finished = sqlite3_backup_finish(backup);
            if (rc != SQLITE_DONE || finished != SQLITE_OK)
                throw std::runtime_error("Could not copy the study database; close the web service and try again");
        }
        fs::rename(temp, target);
    } catch (...) {
        std::error_code ignored;
        fs::remove(temp, ignored);
        throw;
    }
    return true;
}
}
