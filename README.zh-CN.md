# WordYarn · 四级词汇故事集

> 把《大学英语四级考试大纲》的 **4,154 个核心词**编进 **30 篇连续故事**，再用一个能逐句对照、能查词、能自测的本地网站把它们读起来。

![精读视图](docs/assets/screenshot-read.png)

<p align="center">
  <img alt="篇数" src="https://img.shields.io/badge/篇数-30-8a3324">
  <img alt="考纲词" src="https://img.shields.io/badge/考纲词-4%2C154-8a3324">
  <img alt="逐句译文" src="https://img.shields.io/badge/逐句译文-3%2C032-8a3324">
  <img alt="词汇例句" src="https://img.shields.io/badge/词汇例句-5%2C061-8a3324">
  <img alt="离线可用" src="https://img.shields.io/badge/离线-可用-5c6b4a">
</p>

---

## 一、这是什么

以大学生**林远（David）**为主角，室友 Mark、好友 Sarah 贯穿始终，从大一入学写到毕业后的第一年。30 篇文章各自独立成篇、连起来又是一条完整的时间线：

| 阶段 | 篇目 | 内容 |
| --- | --- | --- |
| 大一 | 01–07 | 初到海州、开学典礼、课堂与社团、第一个月、逛市区、社团招新、期末考试 |
| 大二 | 08–13 | 寒假回家、春季运动会、科技节、实验室、海岸志愿、西行之旅 |
| 大三 | 14–20 | 暑期实习、创业·书架、创业·转型、谣言事件、校报编辑部、健康与体检、诈骗风波 |
| 大四 | 21–28 | 安全课堂、春节文化周、博物馆、讲解员、爱与成长、回乡、论文与求职、毕业 |
| 毕业后 | 29–30 | 工作的第一年、周年与终章 |

每篇正文 **1,400–1,600 词、8–10 个自然段**，纯叙事散文；目标词自然嵌在情节里，靠上下文理解，而不是词条堆砌。

## 二、三个视图

### 1. 精读

- 逐句左右对照：左边英文原句，右边中文译文。
- 两种阅读方式：整段连续阅读，或展开成逐句对照。
- 句中目标词带朱砂色点状下划线，点一下弹出词条卡：音标、词性、释义、原文例句、拓展例句、朗读、掌握度。
- 朗读支持单句和整段，整段朗读时逐词高亮。
- 顶部可一键展开/收起全部译文。

### 2. 词表

![词表视图](docs/assets/screenshot-vocab.png)

- 每篇 138–139 个目标词，每词一张卡片：音标、词性、释义、原文句子及译文、拓展例句与用法提示。
- 支持按单词或中文释义搜索，按掌握度筛选，按字母序或出现顺序排列。
- 「定位 →」跳回精读视图并高亮原句。

### 3. 闪卡

![闪卡视图](docs/assets/screenshot-cards.png)

- 正面只显示单词和音标，先回忆再翻面。
- 按「生疏 / 模糊 / 掌握」评分，掌握度低的词优先出现。
- 键盘 `←` `→` 翻卡，`1` `2` `3` 评分。

### 4. 今日 / 查词（需启动学习服务）

C++ 学习服务会把阅读位置、复习到期时间和答题历史存进 SQLite。「今日」可以继续上次读到的段落、复习到期词；「查词」支持中英文搜索并定位原句。

## 三、怎么用

### 方式 A：静态站点（零安装、离线可用）

```bash
# 在仓库根目录
node tools/serve.mjs 8848
# 打开 http://localhost:8848/index.html
```

也可以直接双击 `site/index.html`，用 Chrome / Edge 打开。所有数据都是本地文件，不联网也能用。

深链接：

| 链接 | 打开什么 |
| --- | --- |
| `index.html#ch05/read` | 第 5 章 · 精读 |
| `index.html#ch05/vocab` | 第 5 章 · 词表 |
| `index.html#ch05/cards` | 第 5 章 · 闪卡 |

### 方式 B：带数据库的学习模式

需要 CMake 和 Drogon。Windows 下：

```powershell
cmake -S . -B build
cmake --build build --config Release
powershell -ExecutionPolicy Bypass -File tools/start-study.ps1
# 打开 http://127.0.0.1:8848/
```

学习记录保存在 `var/study.sqlite`。首次配置、接口与测试见 [backend/README.md](backend/README.md)。

### 方式 C：发布到 GitHub Pages

仓库里已带一个 Pages 工作流。推送到 `main` 后，在 **Settings → Pages → Source** 选择 **GitHub Actions**，`site/` 目录会原样发布。页面全部使用相对路径，因此项目子路径（如 `https://<用户名>.github.io/wordyarn/`）也能正常访问。

## 四、目录结构

```
D:\CET4
├─ 词汇故事集/              30 篇故事的 Markdown（正文 + 目标词表）
├─ 四级考纲词汇总表.md      4,154 词总表，含词性、释义和「所在篇目」
├─ content/                人工撰写的逐句译文与词汇例句
│  ├─ chNN.sentences.json     第 NN 章逐句中文译文
│  └─ chNN.vocab.json         第 NN 章音标与例句
├─ site/                   静态网站（HTML / CSS / JS / 生成的数据）
├─ backend/                C++ 学习服务（Drogon + SQLite）
├─ tools/                  切句、构建、校验、本地服务器、截图脚本
├─ plan/                   词表拆分与逐词校验脚本
└─ docs/assets/            README 截图
```

## 五、词汇覆盖是怎么保证的

总词表是唯一数据源。全部词条按轮转方式分配到 30 篇，每篇再用 `plan/check.py` 逐个核对目标词是否真的出现在正文中。校验器识别常见词形变化（`-s/-es/-ed/-ing`、y→ies、辅音双写、`(s)` 变体）以及 `analyze/analyse` 这类斜杠形式。

```bash
python plan/check.py 7        # 校验第 7 篇，必须 0 missing
python plan/style_check.py    # 检查字数、段数与格式
```

当前状态：**30/30 篇通过，0 个遗漏词**。

## 六、修改内容后怎么重建

改完某一章的正文或译文后：

```bash
node tools/validate_content.mjs chNN   # 译文与原文必须逐句对齐
node tools/build_site_data.mjs         # 重新生成 site/data/chNN.js
```

改单词例句时，编辑 `content/chNN.vocab.json` 里对应词的 `ex` 数组，顺序与该词在词表中的行序一致。

## 七、路线图

- [x] 30 篇故事 · 4,154 词 · 全量逐句译文
- [x] 静态站点：精读 / 词表 / 闪卡
- [x] 本地学习服务：间隔复习与答题历史
- [ ] 在线版本
- [ ] 桌面 / 移动端应用
- [ ] 扩展到六级、考研、雅思等词表

## 八、已知限制

- 朗读使用浏览器自带的 Web Speech API，离线可用，但系统需要安装英文语音包；逐词高亮在 Chrome / Edge 中效果最好。
- 静态站点的掌握度与阅读进度存在 `localStorage`，换浏览器或清缓存会丢失；学习模式则存在 SQLite 中。
- 故事为原创；考纲词表依据常见公开版本整理，不同版本之间可能有个别出入。

## 九、更多说明

- 网站细节：[site/README.md](site/README.md)
- 学习服务：[backend/README.md](backend/README.md)
- English README: [README.md](README.md)
