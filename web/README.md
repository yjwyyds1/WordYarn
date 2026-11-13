# 网页版

- `site/`：HTML、样式、交互和构建后的章节数据。启动与使用见 [网站说明](site/README.md)。
- `backend/`：网页和桌面版共同使用的 C++ 学习服务，见 [接口与启动说明](backend/README.md)。
- `词汇故事集/`、`content/`：正文、逐句译文、词汇例句。旧版章节和制作材料放在 `chapters/`、`plan/` 和 `词汇故事集_for_html/`。
- `tools/`、`tests/`：构建、内容校验和接口测试。也可从仓库根目录运行 `npm --prefix web run check` 重建全部章节。

本机网页版继续使用仓库根目录的 `var/study.sqlite`。桌面发布包从这里复用网页资源和后端源码，运行时不需要读取这些源码目录。
