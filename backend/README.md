# CET4 学习服务

Windows 上用 WSL Ubuntu 构建并运行，浏览器访问 Windows 的本地地址。在仓库根目录的 PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/start-study.ps1
```

打开 http://127.0.0.1:8848/ 。保持终端运行；按 Ctrl+C 停止。若端口已占用，可以传入 `-Port 8849`，然后访问对应端口。使用同一地址便于保留浏览器设置。服务仅监听回环地址，供单人本地学习。

新环境请先安装 WSL Ubuntu 和依赖。以下包名适用于已验证的 Ubuntu 26.04；Drogon 的发行版 CMake 包还会查找它编译时启用的其他客户端库，本项目只使用 SQLite。

```sh
sudo apt-get update
sudo apt-get install cmake ninja-build g++ libdrogon-dev libsqlite3-dev libjsoncpp-dev \
  libssl-dev zlib1g-dev uuid-dev libbrotli-dev libc-ares-dev libpq-dev \
  libmariadb-dev libhiredis-dev libyaml-cpp-dev nodejs
cmake -S . -B build-cet4 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build-cet4
./build-cet4/cet4 site var/study.sqlite 8848
```

数据默认保存在项目的 `var/study.sqlite`。阅读位置、词汇复习时间和答题历史由 C++ 保存，浏览器重开或服务重启后可恢复。SQLite 使用 WAL；备份时先停止服务，再复制数据库文件。如果存在 `-wal`、`-shm` 文件，请与数据库成套保留。数据库必须放在静态站点目录之外。此版本没有账户或网络同步。

- `GET /api/study`：阅读位置、词汇状态、本次到期队列和复习统计。
- `POST /api/position`、`POST /api/mark`：记录到达的段落、手动标记词汇。
- `POST /api/review`：保存一次评分和下次复习时间，同一次提交使用相同 attempt ID，数据库在一个事务里更新计划与历史。
- `GET /api/history`：最近 100 次答题。
- 评分后，「没想起来」约 10 分钟后再出现，「有点模糊」约 1 天后再出现。「想起来了」按到期复习中的连续成功次数安排约 1、3、7 天。连续两次到期时都想起的词单独计数。右侧词卡的手动标记不算一次答题。
- 文章、译文和词表仍由原来的脚本生成。双击 HTML 仍可本地阅读和练习；各浏览器来源的本地存储相互隔离。已有掌握度仅在同一来源首次接入数据库时自动导入。离线时同源缓存的写入会在重新连接后提交。

接口与重启测试（使用隔离的临时数据库）：

```powershell
wsl -- env CET4_EXE=build-cet4/cet4 node --test tests/study-api.mjs
```
