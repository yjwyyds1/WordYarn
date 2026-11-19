#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <winsock2.h>
#include <shellapi.h>
#include <shlobj.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <dwmapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <sherpa-onnx/c-api/c-api.h>
#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <future>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>
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
constexpr UINT windowActionMessage = WM_APP + 4;
constexpr int appIcon = 101;
constexpr UINT_PTR readyTimer = 1;
constexpr UINT_PTR closeTimer = 2;
constexpr UINT_PTR speechTimer = 3;
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
struct SpeechRequest {
    unsigned id;
    float rate;
    int volume, speaker;
    std::string text;
};
struct SpeechResult {
    unsigned id;
    std::wstring audio;
};
struct App {
    Handle child, job;
    HWND window = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> view;
    fs::path voicePack;
    std::unique_ptr<const SherpaOnnxOfflineTts, decltype(&SherpaOnnxDestroyOfflineTts)>
        voice{nullptr, SherpaOnnxDestroyOfflineTts};
    std::optional<SpeechRequest> nextSpeech;
    std::future<SpeechResult> speechJob;
    unsigned speechId = 0;
    HBRUSH frameBrush = nullptr;
    std::wstring token, origin;
    fs::path profile;
    int port = 0;
    bool closing = false;
    bool fullscreen = true;
    unsigned closeAttempt = 0;
    unsigned checks = 0;

    ~App() {
        if (frameBrush) DeleteObject(frameBrush);
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
        if (!fullscreen) {
            const auto edge = MulDiv(5, GetDpiForWindow(window), 96);
            InflateRect(&area, -edge, -edge);
        }
        if (controller) controller->put_Bounds(area);
    }

    void stopNativeSpeech() {
        KillTimer(window, speechTimer);
        nextSpeech.reset();
        speechId = 0;
    }

    void speechReply(const SpeechResult& result) {
        if (!view || result.id != speechId) return;
        const auto script = L"window.wordYarnSpeechResult?.(" + std::to_wstring(result.id) +
            (result.audio.empty() ? L",false)" : L",true,'" + result.audio + L"')");
        view->ExecuteScript(script.c_str(), nullptr);
    }

    // Only the synthesis worker initializes and uses the model.
    std::wstring synthesize(const SpeechRequest& request) {
        if (!voice) {
            const auto model = voicePack / "model.onnx";
            const auto voices = voicePack / "voices.bin";
            const auto tokens = voicePack / "tokens.txt";
            const auto data = voicePack / "espeak-ng-data";
            if (!fs::is_regular_file(model) || !fs::is_regular_file(voices) ||
                !fs::is_regular_file(tokens) || !fs::is_regular_file(data / "phontab")) return {};
            const auto modelPath = model.u8string(), voicesPath = voices.u8string();
            const auto tokensPath = tokens.u8string(), dataPath = data.u8string();
            SherpaOnnxOfflineTtsConfig config{};
            config.model.kitten.model = modelPath.c_str();
            config.model.kitten.voices = voicesPath.c_str();
            config.model.kitten.tokens = tokensPath.c_str();
            config.model.kitten.data_dir = dataPath.c_str();
            config.model.num_threads = 2;
            voice.reset(SherpaOnnxCreateOfflineTts(&config));
        }
        if (!voice) return {};
        SherpaOnnxGenerationConfig options{};
        options.silence_scale = 0.2f;
        options.speed = request.rate;
        options.sid = request.speaker;
        const std::unique_ptr<const SherpaOnnxGeneratedAudio, decltype(&SherpaOnnxDestroyOfflineTtsGeneratedAudio)>
            clip(SherpaOnnxOfflineTtsGenerateWithConfig(voice.get(), request.text.c_str(), &options, nullptr, nullptr),
                SherpaOnnxDestroyOfflineTtsGeneratedAudio);
        if (!clip || !clip->samples || clip->n <= 0) return {};
        const auto waveBytes = SherpaOnnxWaveFileSize(clip->n);
        if (waveBytes <= 0 || waveBytes > 8 * 1024 * 1024) return {};
        std::vector<float> samples(clip->samples, clip->samples + clip->n);
        float gain = request.volume / 100.0f, peak = 0;
        for (const auto sample : samples) peak = std::max(peak, std::abs(sample));
        if (peak > 0) gain = std::min(gain, 1.0f / peak);
        for (auto& sample : samples) sample *= gain;
        std::string wave(static_cast<size_t>(waveBytes), '\0');
        SherpaOnnxWriteWaveToBuffer(samples.data(), clip->n, clip->sample_rate, wave.data());
        DWORD length = 0;
        constexpr auto flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
        const auto* bytes = reinterpret_cast<const BYTE*>(wave.data());
        const auto size = static_cast<DWORD>(wave.size());
        if (!CryptBinaryToStringW(bytes, size, flags, nullptr, &length)) return {};
        std::wstring encoded(length, L'\0');
        if (!CryptBinaryToStringW(bytes, size, flags, encoded.data(), &length)) return {};
        encoded.resize(length);
        return encoded;
    }

    void pollSpeech() {
        if (speechJob.valid()) {
            if (speechJob.wait_for(std::chrono::seconds(0)) != std::future_status::ready) return;
            speechReply(speechJob.get());
        }
        if (!nextSpeech) { KillTimer(window, speechTimer); return; }
        auto request = std::move(*nextSpeech);
        nextSpeech.reset();
        const auto id = request.id;
        try {
            speechJob = std::async(std::launch::async, [this, request = std::move(request)] {
                try { return SpeechResult{request.id, synthesize(request)}; }
                catch (const std::exception&) { return SpeechResult{request.id, {}}; }
            });
        } catch (const std::exception&) { speechReply({id, {}}); }
    }

    void speechCommand(const std::wstring& command) {
        if (command == L"speech:stop") { stopNativeSpeech(); return; }
        if (command.rfind(L"speech:play:", 0) != 0 || command.size() > 2200) return;
        size_t start = 12;
        std::array<std::wstring, 4> fields;
        for (auto& field : fields) {
            const auto end = command.find(L':', start);
            if (end == std::wstring::npos) return;
            field = command.substr(start, end - start);
            start = end + 1;
        }
        try {
            const auto id = std::stoul(fields[0]);
            const auto rate = std::stof(fields[1]);
            const auto volume = std::stoi(fields[2]);
            const auto speaker = std::stoi(fields[3]);
            if (!id || !std::isfinite(rate) || speaker < 0 || speaker >= 8 || start == command.size()) return;
            const auto* text = command.data() + start;
            const auto chars = static_cast<int>(command.size() - start);
            const auto bytes = WideCharToMultiByte(CP_UTF8, 0, text, chars, nullptr, 0, nullptr, nullptr);
            if (bytes <= 0) return;
            std::string utf8(bytes, '\0');
            if (!WideCharToMultiByte(CP_UTF8, 0, text, chars, utf8.data(), bytes, nullptr, nullptr)) return;
            speechId = id;
            if (!SetTimer(window, speechTimer, 40, nullptr)) { speechReply({speechId, {}}); return; }
            nextSpeech = SpeechRequest{speechId, std::clamp(rate, 0.5f, 2.0f),
                std::clamp(volume, 0, 150), speaker, std::move(utf8)};
            pollSpeech();
        } catch (const std::exception&) { return; }
    }

    void layoutWindow() {
        const HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        MONITORINFO info{sizeof(info)};
        if (!GetMonitorInfoW(monitor, &info)) return;
        RECT area = fullscreen ? info.rcMonitor : info.rcWork;
        if (!fullscreen) {
            const auto pad = MulDiv(36, GetDpiForWindow(window), 96);
            InflateRect(&area, -pad, -pad);
        }
        const COLORREF border = DWMWA_COLOR_NONE;
        DwmSetWindowAttribute(window, DWMWA_BORDER_COLOR, &border, sizeof(border));
        const auto corner = fullscreen ? DWMWCP_DONOTROUND : DWMWCP_ROUND;
        DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE, &corner, sizeof(corner));
        SetWindowLongPtrW(window, GWL_STYLE, WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX |
            WS_CLIPCHILDREN | (fullscreen ? 0 : WS_THICKFRAME) | (IsWindowVisible(window) ? WS_VISIBLE : 0));
        SetWindowPos(window, nullptr, area.left, area.top, area.right - area.left, area.bottom - area.top,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        if (view) view->ExecuteScript(fullscreen ? L"window.wordYarnWindowState?.(true)" :
            L"window.wordYarnWindowState?.(false)", nullptr);
        resize();
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
                                ComPtr<ICoreWebView2Controller2> background;
                                if (SUCCEEDED(controller.As(&background)))
                                    background->put_DefaultBackgroundColor({255, 241, 234, 222});
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
                if (!IsWindow(window)) return S_OK;
                LPWSTR source = nullptr, message = nullptr;
                if (SUCCEEDED(args->get_Source(&source)) && source &&
                    std::wstring(source).rfind(origin, 0) == 0 &&
                    SUCCEEDED(args->TryGetWebMessageAsString(&message)) && message) {
                    const auto attempt = std::to_wstring(closeAttempt);
                    const std::wstring answer = message;
                    if (closing && (answer == L"saved:" + attempt || answer == L"unsaved:" + attempt))
                        PostMessageW(window, finishCloseMessage, closeAttempt, answer == L"saved:" + attempt);
                    else if (!closing && answer == L"window:fullscreen")
                        PostMessageW(window, windowActionMessage, 1, 0);
                    else if (!closing && answer == L"window:minimize")
                        PostMessageW(window, windowActionMessage, 2, 0);
                    else if (!closing && answer == L"window:close")
                        PostMessageW(window, WM_CLOSE, 0, 0);
                    else if (!closing && answer == L"window:move")
                        PostMessageW(window, windowActionMessage, 3, 0);
                    else if (!closing && answer == L"window:mixer")
                        PostMessageW(window, windowActionMessage, 4, 0);
                    else if (!closing && answer.rfind(L"speech:", 0) == 0)
                        speechCommand(answer);
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
    case WM_NCCALCSIZE:
        if (!app->fullscreen && w) return 0;
        break;
    case WM_NCHITTEST:
        if (!app->fullscreen) {
            RECT r{};
            GetWindowRect(hwnd, &r);
            const auto edge = MulDiv(5, GetDpiForWindow(hwnd), 96);
            const auto x = GET_X_LPARAM(l), y = GET_Y_LPARAM(l);
            const bool left = x < r.left + edge, right = x >= r.right - edge;
            if (y < r.top + edge) return left ? HTTOPLEFT : right ? HTTOPRIGHT : HTTOP;
            if (y >= r.bottom - edge) return left ? HTBOTTOMLEFT : right ? HTBOTTOMRIGHT : HTBOTTOM;
            if (left || right) return left ? HTLEFT : HTRIGHT;
        }
        break;
    case WM_SIZE: app->resize(); return 0;
    case WM_DISPLAYCHANGE: app->layoutWindow(); return 0;
    case windowActionMessage:
        if (w == 1) { app->fullscreen = !app->fullscreen; app->layoutWindow(); }
        if (w == 2) ShowWindow(hwnd, SW_MINIMIZE);
        if (w == 3 && !app->fullscreen && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
            POINT point{}; GetCursorPos(&point);
            ReleaseCapture();
            SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, MAKELPARAM(point.x, point.y));
        }
        if (w == 4) ShellExecuteW(hwnd, L"open", L"ms-settings:apps-volume", nullptr, nullptr, SW_SHOWNORMAL);
        return 0;
    case WM_CLOSE: app->close(); return 0;
    case WM_DESTROY:
        KillTimer(hwnd, readyTimer);
        KillTimer(hwnd, closeTimer);
        app->stopNativeSpeech();
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
        if (w == speechTimer) {
            app->pollSpeech();
            return 0;
        }
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
    case WM_ERASEBKGND: {
        RECT area{};
        GetClientRect(hwnd, &area);
        FillRect(reinterpret_cast<HDC>(w), &area, app->frameBrush);
        return 1;
    }
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        auto dc = BeginPaint(hwnd, &paint);
        RECT area{};
        GetClientRect(hwnd, &area);
        if (!app->view) {
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, RGB(234, 241, 255));
            DrawTextW(dc, L"正在打开词汇故事集…", -1, &area, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        }
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
        SetCurrentProcessExplicitAppUserModelID(L"WordYarn.CET4.Desktop");
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
        app.voicePack = folder / L"voice";
        app.port = choosePort();
        app.origin = L"http://127.0.0.1:" + std::to_wstring(app.port) + L"/";
        app.token = sessionToken();
        app.profile = data / L"WebView2";
        app.frameBrush = CreateSolidBrush(RGB(23, 39, 70));
        app.launch(folder, db);

        WNDCLASSW wc{};
        wc.hInstance = instance;
        wc.lpfnWndProc = windowProc;
        wc.lpszClassName = windowClass;
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(appIcon));
        if (!RegisterClassW(&wc)) throw std::runtime_error("Cannot register desktop window");
        const auto window = CreateWindowExW(WS_EX_APPWINDOW, windowClass, title, WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX,
            CW_USEDEFAULT, CW_USEDEFAULT, 1220, 850, nullptr, nullptr, instance, &app);
        if (!window) throw std::runtime_error("Cannot create desktop window");
        SendMessageW(window, WM_SETICON, ICON_SMALL, (LPARAM)LoadImageW(instance,
            MAKEINTRESOURCEW(appIcon), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_SHARED));
        SendMessageW(window, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(wc.hIcon));
        app.layoutWindow();
        ShowWindow(window, show == SW_HIDE ? SW_SHOW : show);
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
