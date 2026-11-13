#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winsock2.h>
#include <shellapi.h>
#include <shlobj.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <wrl.h>
#include <WebView2.h>
#include <array>
#include <filesystem>
#include <stdexcept>
#include <string>
#include "migration.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;

namespace {
constexpr wchar_t windowClass[] = L"WordYarn.CET4.Window";
constexpr wchar_t title[] = L"WordYarn · 四级词汇故事集";
constexpr UINT focusMessage = WM_APP + 1;
constexpr UINT finishCloseMessage = WM_APP + 2;
constexpr UINT startupFailureMessage = WM_APP + 3;
constexpr UINT_PTR readyTimer = 1;
constexpr UINT_PTR closeTimer = 2;
struct Handle {
    HANDLE value = nullptr;
    ~Handle() { if (value) CloseHandle(value); }
    Handle() = default;
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};
struct Http {
    HINTERNET value;
    ~Http() { if (value) WinHttpCloseHandle(value); }
    explicit operator bool() const { return value != nullptr; }
};
struct App {
    Handle child, job;
    HWND window = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> view;
    std::wstring token, origin;
    fs::path profile;
    int port = 0;
    bool closing = false;
    unsigned closeAttempt = 0;
    unsigned checks = 0;

    ~App() {
        if (job.value) {
            CloseHandle(job.value);
            job.value = nullptr;
        }
        if (child.value) WaitForSingleObject(child.value, 3000);
    }

    void fail(const wchar_t* message) {
        if (IsWindow(window)) PostMessageW(window, startupFailureMessage, 0, reinterpret_cast<LPARAM>(message));
    }

    void resize() {
        RECT area{};
        GetClientRect(window, &area);
        if (controller) controller->put_Bounds(area);
    }

    bool ready() const {
        Http session{WinHttpOpen(L"WordYarn", WINHTTP_ACCESS_TYPE_NO_PROXY, nullptr, nullptr, 0)};
        if (!session) return false;
        WinHttpSetTimeouts(session.value, 250, 250, 250, 250);
        Http connection{WinHttpConnect(session.value, L"127.0.0.1", static_cast<INTERNET_PORT>(port), 0)};
        if (!connection) return false;
        Http request{WinHttpOpenRequest(connection.value, L"GET", L"/api/study", nullptr, nullptr, nullptr, 0)};
        if (!request) return false;
        DWORD redirect = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        if (!WinHttpSetOption(request.value, WINHTTP_OPTION_REDIRECT_POLICY, &redirect, sizeof(redirect))) return false;
        const auto header = L"X-CET4-Token: " + token;
        if (!WinHttpSendRequest(request.value, header.c_str(), static_cast<DWORD>(header.size()), nullptr, 0, 0, 0)
            || !WinHttpReceiveResponse(request.value, nullptr)) return false;
        DWORD status = 0, size = sizeof(status);
        return WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            nullptr, &status, &size, nullptr) && status == 200;
    }

    void loadView() {
        auto result = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this](HRESULT status, ICoreWebView2Environment* env) -> HRESULT {
                    if (!IsWindow(window)) return S_OK;
                    if (FAILED(status) || !env) { fail(L"无法加载 WebView2，请检查 Windows 上的 WebView2 Runtime。"); return S_OK; }
                    auto rc = env->CreateCoreWebView2Controller(window,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                            [this](HRESULT hr, ICoreWebView2Controller* ctl) -> HRESULT {
                                if (!IsWindow(window)) return S_OK;
                                if (FAILED(hr) || !ctl) { fail(L"无法创建阅读窗口。"); return S_OK; }
                                controller = ctl;
                                if (FAILED(controller->get_CoreWebView2(&view)) || !view) {
                                    fail(L"无法初始化阅读窗口。"); return S_OK;
                                }
                                configureView();
                                resize();
                                return S_OK;
                            }).Get());
                    if (FAILED(rc)) fail(L"无法创建阅读窗口。");
                    return S_OK;
                }).Get());
        if (FAILED(result)) fail(L"无法启动 WebView2，请安装 Microsoft Edge WebView2 Runtime。");
    }

    void configureView() {
        ComPtr<ICoreWebView2Settings> settings;
        if (SUCCEEDED(view->get_Settings(&settings))) {
            settings->put_AreDevToolsEnabled(FALSE);
            settings->put_AreDefaultContextMenusEnabled(FALSE);
        }
        EventRegistrationToken event{};
        view->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                LPWSTR raw = nullptr;
                if (SUCCEEDED(args->get_Uri(&raw)) && raw) {
                    const bool allowed = std::wstring(raw).rfind(origin, 0) == 0;
                    CoTaskMemFree(raw);
                    if (!allowed) args->put_Cancel(TRUE);
                } else args->put_Cancel(TRUE);
                return S_OK;
            }).Get(), &event);
        view->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                return args->put_Handled(TRUE);
            }).Get(), &event);
        view->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                if (!closing || !IsWindow(window)) return S_OK;
                LPWSTR source = nullptr, message = nullptr;
                if (SUCCEEDED(args->get_Source(&source)) && source &&
                    std::wstring(source).rfind(origin, 0) == 0 &&
                    SUCCEEDED(args->TryGetWebMessageAsString(&message)) && message) {
                    const auto attempt = std::to_wstring(closeAttempt);
                    const std::wstring answer = message;
                    if (answer == L"saved:" + attempt || answer == L"unsaved:" + attempt)
                        PostMessageW(window, finishCloseMessage, closeAttempt, answer == L"saved:" + attempt);
                }
                CoTaskMemFree(source);
                CoTaskMemFree(message);
                return S_OK;
            }).Get(), &event);
        const auto script = L"if (window === top && location.href.startsWith('" + origin +
            L"')) Object.defineProperty(window, 'wordYarnDesktop', { value: Object.freeze({token:'" + token + L"'}) });";
        auto rc = view->AddScriptToExecuteOnDocumentCreated(script.c_str(),
            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                [this](HRESULT hr, LPCWSTR) -> HRESULT {
                    if (!IsWindow(window)) return S_OK;
                    if (FAILED(hr) || FAILED(view->Navigate(origin.c_str())))
                        fail(L"无法打开本地阅读页。");
                    return S_OK;
                }).Get());
        if (FAILED(rc)) fail(L"无法初始化学习记录连接。");
    }

    void close() {
        if (closing) return;
        if (!view) { DestroyWindow(window); return; }
        closing = true;
        ++closeAttempt;
        if (!SetTimer(window, closeTimer, 12000, nullptr)) {
            PostMessageW(window, finishCloseMessage, closeAttempt, FALSE);
            return;
        }
        const auto script = L"(async()=>{let ok=false;try{ok=await window.wordYarnFlush?.()}catch{}"
            L"window.chrome.webview.postMessage((ok?'saved:':'unsaved:')+'" + std::to_wstring(closeAttempt) + L"')})()";
        if (FAILED(view->ExecuteScript(script.c_str(), nullptr)))
            PostMessageW(window, finishCloseMessage, closeAttempt, FALSE);
    }

    void confirmClose() {
        ++closeAttempt; // Do not accept a reply from an expired close request.
        if (MessageBoxW(window,
            L"还有进度未确认写入 SQLite。建议留在软件中，稍后重试。\n仍然关闭窗口吗？",
            title, MB_YESNO | MB_DEFBUTTON2 | MB_ICONWARNING) == IDYES) DestroyWindow(window);
        else {
            closing = false;
            if (view) view->ExecuteScript(L"window.wordYarnCancelClose?.()", nullptr);
        }
    }

    void launch(const fs::path& folder, const fs::path& db) {
        const auto exe = folder / L"cet4.exe";
        auto command = L"\"" + exe.wstring() + L"\" \"" + (folder / L"site").wstring() +
            L"\" \"" + db.wstring() + L"\" " + std::to_wstring(port);
        job.value = CreateJobObjectW(nullptr, nullptr);
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!job.value || !SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)))
            throw std::runtime_error("Cannot initialize backend process group");
        STARTUPINFOW start{};
        start.cb = sizeof(start);
        PROCESS_INFORMATION process{};
        if (!SetEnvironmentVariableW(L"CET4_DESKTOP_TOKEN", token.c_str()))
            throw std::runtime_error("Cannot prepare backend session");
        const auto created = CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE,
            CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, folder.c_str(), &start, &process);
        SetEnvironmentVariableW(L"CET4_DESKTOP_TOKEN", nullptr);
        if (!created) throw std::runtime_error("Cannot start cet4.exe; keep the package files together");
        child.value = process.hProcess;
        Handle thread;
        thread.value = process.hThread;
        if (!AssignProcessToJobObject(job.value, child.value) || ResumeThread(thread.value) == static_cast<DWORD>(-1)) {
            TerminateProcess(child.value, 1);
            throw std::runtime_error("Cannot run the local study service");
        }
    }
};

LRESULT CALLBACK windowProc(HWND hwnd, UINT msg, WPARAM w, LPARAM l) {
    if (msg == WM_NCCREATE) {
        auto* app = static_cast<App*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);
        app->window = hwnd;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
    }
    auto* app = reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (!app) return DefWindowProcW(hwnd, msg, w, l);
    switch (msg) {
    case WM_SIZE: app->resize(); return 0;
    case WM_CLOSE: app->close(); return 0;
    case WM_DESTROY:
        KillTimer(hwnd, readyTimer);
        KillTimer(hwnd, closeTimer);
        if (app->controller) app->controller->Close();
        PostQuitMessage(0);
        return 0;
    case WM_GETMINMAXINFO:
        reinterpret_cast<MINMAXINFO*>(l)->ptMinTrackSize = { 470, 390 };
        return 0;
    case focusMessage:
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        return 0;
    case finishCloseMessage:
        if (app->closing && w == app->closeAttempt) {
            KillTimer(hwnd, closeTimer);
            if (l) DestroyWindow(hwnd);
            else app->confirmClose();
        }
        return 0;
    case startupFailureMessage:
        MessageBoxW(hwnd, reinterpret_cast<const wchar_t*>(l), title, MB_OK | MB_ICONERROR);
        DestroyWindow(hwnd);
        return 0;
    case WM_TIMER:
        if (w == closeTimer) {
            KillTimer(hwnd, closeTimer);
            if (app->closing) app->confirmClose();
            return 0;
        }
        if (w != readyTimer) break;
        if (WaitForSingleObject(app->child.value, 0) == WAIT_OBJECT_0 || ++app->checks > 45) {
            KillTimer(hwnd, readyTimer);
            app->fail(L"本地学习服务未能启动。请检查程序文件和 SQLite 数据目录。");
        } else if (app->ready()) {
            KillTimer(hwnd, readyTimer);
            app->loadView();
        }
        return 0;
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        auto dc = BeginPaint(hwnd, &paint);
        RECT area{};
        GetClientRect(hwnd, &area);
        DrawTextW(dc, L"正在打开词汇故事集…", -1, &area, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        EndPaint(hwnd, &paint);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, w, l);
}

fs::path installFolder() {
    std::wstring module(32768, L'\0');
    const auto count = GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
    if (!count || count == module.size()) throw std::runtime_error("Cannot locate installation directory");
    module.resize(count);
    return fs::path(module).parent_path();
}

fs::path dataFolder() {
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &raw)))
        throw std::runtime_error("Cannot find Windows Local AppData");
    const fs::path path(raw);
    CoTaskMemFree(raw);
    return path / L"WordYarn";
}

std::wstring sessionToken() {
    std::array<unsigned char, 32> bytes{};
    if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
        throw std::runtime_error("Cannot initialize local session");
    const std::wstring digits = L"0123456789abcdef";
    std::wstring token;
    for (const auto b : bytes) { token += digits[b >> 4]; token += digits[b & 15]; }
    return token;
}

int choosePort() {
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("Windows networking is unavailable");
    int result = 0;
    const auto sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock != INVALID_SOCKET) {
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = htons(48848);
        if (bind(sock, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0)
            result = 48848;
        closesocket(sock);
    }
    WSACleanup();
    if (!result) throw std::runtime_error("Desktop port 48848 is busy; close the conflicting application and try again");
    return result;
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    int argc = 0;
    auto* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    const bool migrationCli = argv && argc == 4 && std::wstring(argv[1]) == L"--migrate";
    if (migrationCli) {
        int code = 0;
        try { wordyarn::migrate(argv[2], argv[3]); } catch (...) { code = 1; }
        LocalFree(argv);
        return code;
    }
    const std::wstring overrideArg = argv && argc == 3 && std::wstring(argv[1]) == L"--data-dir" ? argv[2] : L"";
    if (argv) LocalFree(argv);
    try {
        Handle singleton;
        singleton.value = CreateMutexW(nullptr, FALSE, L"Local\\WordYarn.CET4.Desktop");
        if (!singleton.value) throw std::runtime_error("Cannot open the application lock");
        if (GetLastError() == ERROR_ALREADY_EXISTS) {
            if (auto previous = FindWindowW(windowClass, nullptr)) PostMessageW(previous, focusMessage, 0, 0);
            return 0;
        }
        const auto folder = installFolder();
        const auto data = overrideArg.empty() ? dataFolder() : fs::absolute(overrideArg);
        fs::create_directories(data);
        const auto old = folder.parent_path().parent_path() / L"var" / L"study.sqlite";
        const auto db = data / L"study.sqlite";
        // The previous database stays in place as the pre-migration backup.
        if (overrideArg.empty()) wordyarn::migrate(old, db);
        const auto com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        if (FAILED(com)) throw std::runtime_error("Cannot initialize Windows UI");
        struct ComScope { ~ComScope() { CoUninitialize(); } } comScope;
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        App app;
        app.port = choosePort();
        app.origin = L"http://127.0.0.1:" + std::to_wstring(app.port) + L"/";
        app.token = sessionToken();
        app.profile = data / L"WebView2";
        app.launch(folder, db);

        WNDCLASSW wc{};
        wc.hInstance = instance;
        wc.lpfnWndProc = windowProc;
        wc.lpszClassName = windowClass;
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
        wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
        if (!RegisterClassW(&wc)) throw std::runtime_error("Cannot register desktop window");
        const auto window = CreateWindowExW(0, windowClass, title, WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT, CW_USEDEFAULT, 1220, 850, nullptr, nullptr, instance, &app);
        if (!window) throw std::runtime_error("Cannot create desktop window");
        ShowWindow(window, show);
        if (!SetTimer(window, readyTimer, 150, nullptr)) {
            DestroyWindow(window);
            throw std::runtime_error("Cannot wait for the study service");
        }
        MSG message{};
        while (GetMessageW(&message, nullptr, 0, 0) > 0) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        return static_cast<int>(message.wParam);
    } catch (const std::exception& e) {
        const std::string detail = e.what();
        const std::wstring wide(detail.begin(), detail.end());
        MessageBoxW(nullptr, (L"词汇故事集未能启动。\n\n" + wide).c_str(), title, MB_OK | MB_ICONERROR);
        return 1;
    }
}
