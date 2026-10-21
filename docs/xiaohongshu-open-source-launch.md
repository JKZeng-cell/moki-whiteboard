# MOKI 白板小红书开源发布包

## 发布定位

一句话：一个本地优先、支持无限画布与 MCP 的开源白板，既能让人自由创作，也能让 Agent 直接读取和修改画布。

适合人群：独立开发者、设计师、产品经理、内容创作者、知识管理用户，以及正在搭建 Agent 工作流的人。

本次可公开事实：

- MOKI 白板 `0.1.7` 源码开放，采用 MIT License。
- Windows / Electron 桌面应用，数据默认保存在本机 SQLite。
- 支持便签、文本、图形、钢笔、思维导图、图片、文件、网页卡片、页面分组和深浅色模式。
- 支持标准 MCP stdio 与 Streamable HTTP，共 16 个 Agent 工具。
- 支持与 MOKI 工作台双向导入导出 `.moki` 白板文件。
- 当前验证基线为 21 个测试文件、251 项测试通过。
- 当前 Windows 安装包尚未代码签名；源码仓库不包含用户数据库、素材缓存或历史安装包。

## 首发标题备选

推荐标题：

> 我把 MOKI 无限白板开源了｜Agent 也能直接操作

其他备选：

1. 不是又一个白板：MOKI 白板正式开源
2. 本地优先 + 无限画布 + MCP，我把它开源了
3. 让 AI 真正改画布：MOKI 白板开源
4. 做了一个能被 Agent 操作的无限白板
5. 从工作台拆出一款独立白板，今天开源

## 封面文案

主标题：

> MOKI 白板开源了

副标题：

> 无限画布 × 本地优先 × MCP Agent

角标建议：

- MIT License
- 16 个 MCP 工具
- Windows 客户端

## 九图发布顺序

1. 封面：使用上面的主标题、副标题和三个角标，背景可使用深色画布截图局部。
2. 白板管理：`docs/assets/screenshots/board-manager.png`，配字“多个白板统一管理，保留上次编辑缩略图”。
3. 无限画布：`docs/assets/screenshots/canvas-light.png`，配字“便签、图形、钢笔、思维导图、文件和网页都在同一张画布”。
4. 深色模式：`docs/assets/screenshots/canvas-dark.png`，配字“浅色 / 深色 / 跟随系统”。
5. Agent 连接：`docs/assets/screenshots/mcp-settings.png`，配字“标准 MCP：stdio + Streamable HTTP”。
6. 功能卡：列出“多页面与分组、对齐与分布、网页预览、文件夹素材、版本历史、PNG 导出”。
7. 本地优先：用图示表达“白板内容 → 本机 SQLite；素材缓存 → 自选目录；不内置模型账号”。
8. 开发者卡：`npm ci`、`npm run dev`、`npm run check`，配字“React + Electron + SQLite + MCP SDK”。
9. 行动页：GitHub 地址、Star / Issue / PR 邀请，并注明“安装包未签名，请核对 SHA-256”。

建议所有图片统一使用 3:4 版式；截图等比放入圆角容器，不裁掉工具栏、MCP 连接方式或版本号。不要在公开图片中出现本机绝对路径、真实白板内容、数据库路径和访问令牌。

## 正文长版

我把 MOKI 工作台里的无限白板，拆成了一款可以独立运行的开源应用：MOKI 白板。

它不是只给人用的画布。我给它开放了标准 MCP，让 Agent 可以读取白板、创建页面、添加便签和思维导图、修改内容、对齐元素、导出文件，还能通过版本校验避免旧操作覆盖新内容。

目前已经支持：

• 无限画布、连续缩放和缩略图导航
• 便签、文本、图形、箭头、钢笔与思维导图
• 图片、文件、网页卡片和页面素材列表
• 多页面、页面分组、对齐分布、版本历史
• 深色 / 浅色 / 跟随系统
• 本地 SQLite、素材缓存路径自定义
• MCP stdio + Streamable HTTP，共 16 个工具
• 与 MOKI 工作台白板文件双向互导

这次开源我最在意三件事：

1. 本地优先：白板内容和素材默认留在自己的电脑里。
2. Agent 可操作：不是“把 AI 放在旁边聊天”，而是让 Agent 真正理解并修改画布。
3. 文件可迁移：通过 `.moki` 文件在独立白板和工作台之间移动完整内容。

项目采用 MIT License，源码、开发说明、MCP 接入方式和贡献指南都已经整理到 GitHub。当前版本是 0.1.7，251 项测试通过。

如果你也在做 Agent 工具、知识管理或可视化创作，欢迎试用、Star、提 Issue，或者直接来一起完善它。

GitHub：https://github.com/JKZeng-cell/moki-whiteboard

## 正文短版

MOKI 白板正式开源。

这是一个本地优先的无限画布，也是一块能被 Agent 直接操作的白板：支持标准 MCP、16 个工具、便签 / 图形 / 钢笔 / 思维导图 / 图片 / 文件 / 网页、多页面和深浅色模式，还能与 MOKI 工作台双向互导。

当前版本 0.1.7，MIT License，251 项测试通过。

GitHub：https://github.com/JKZeng-cell/moki-whiteboard

欢迎 Star、Issue 和 PR。也想听听你最希望 Agent 在白板里自动完成什么？

## 首条评论

> 项目地址：https://github.com/JKZeng-cell/moki-whiteboard
> Windows 安装包尚未签名，下载后请先核对发布页 SHA-256。开发者可直接 `npm ci && npm run dev`。

## 话题建议

`#开源项目` `#独立开发` `#AI工具` `#MCP` `#效率工具` `#无限画布` `#白板工具` `#知识管理` `#Agent` `#程序员日常`

发布时选择 6–8 个最相关话题，不要把所有话题全部堆入正文。

## 发布检查表

- GitHub 仓库已公开，未登录窗口可以访问 README、LICENSE 和源码。
- README 截图与仓库实际版本一致。
- CI 通过；提交 SHA 已记录。
- 链接使用 `https://github.com/JKZeng-cell/moki-whiteboard`，没有本地路径。
- 如果同步发布安装包，Release 版本、文件名、SHA-256 与应用内版本一致。
- 正文没有宣称 macOS、Linux 客户端或代码签名能力。
- 评论区置顶仓库地址，并邀请用户提出具体 Agent 白板场景。
