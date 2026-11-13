# WordYarn Windows 桌面版

运行本地打包目录中的 `dist/WordYarn.exe`。请保留同目录的 `cet4.exe`、DLL 和 `site/`。首次启动前，建议先在网页版等到「已保存到 SQLite」，然后退出旧的学习服务。

- 桌面版具备独立窗口，由 Windows 原生 C++ 程序启动本机 Drogon 后端。程序使用已安装的 WebView2 Runtime，并随包提供 SQLite 库；无需启动 Edge 浏览器、PowerShell 或 WSL。文章、查询、复习和保存可离线使用。
- 第一次启动检查仓库根目录的 `var/study.sqlite`，通过 SQLite 备份接口把已提交的记录（包括 WAL）导入 `%LOCALAPPDATA%\WordYarn\study.sqlite`。旧数据库留在原处。识别旧库依赖默认的 `desktop/dist/` 目录位置，请先从这个位置启动一次。
- 导入发生一次：只要桌面数据库已经存在，后续启动不会再覆盖它。网页版与桌面版从此各自保存。仅存于浏览器的离线操作，需先在网页连接服务后写入 SQLite，才会随数据库导入。
- 写入确认后显示「已保存到 SQLite」。正常关闭时先保存待写入的进度；无法确认时，窗口会问是否要继续关闭。软件升级不要覆盖用户数据目录。
- 服务仅监听 `127.0.0.1:48848`，API 需要该次启动的会话令牌；没有账号、同步或局域网入口。若需要备份，先正常关闭软件，再复制其 SQLite 数据库及仍存在的 WAL/SHM 文件。恢复时也要先关闭软件。

## 本地构建

需要 MSVC x64 和 Windows SDK、CMake、Ninja、已初始化的 vcpkg，以及从官方 NuGet 获取并解包的 `Microsoft.Web.WebView2` SDK（此版使用 1.0.4314.35）。在 x64 Developer PowerShell 中从仓库根目录运行：

```powershell
npm --prefix web run build
powershell -ExecutionPolicy Bypass -File desktop/build.ps1 -VcpkgRoot <vcpkg目录> -WebView2Sdk <SDK解包目录>
node --test desktop/tests/native.mjs
```

也可用 `-InstalledDir` 指向已编译好的 vcpkg 依赖目录，避免重新安装依赖。构建编译 `web/backend`，然后把 `web/site` 和依赖打进 `desktop/dist`。修改文章、样式或页面时，维护 `web/` 下的源码，重新生成和打包即可。不要把 `dist/`、构建依赖和学习数据库纳入提交。
