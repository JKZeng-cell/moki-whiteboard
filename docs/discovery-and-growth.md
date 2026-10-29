# MOKI Whiteboard：发现与自然增长计划

调研日期：2026-10-29。以下是执行建议，不是 Star 数量或搜索排名承诺。没有自动向第三方投稿、创建外部 PR、发布 npm 包或购买推广。

## 当前公开基线

- GitHub：19 Stars、4 Forks；本次检查时仓库为公开状态，最近三次 CI 成功。
- About 原先只有中文，Topics 原先为 6 个；已补充英文描述和 7 个相关主题。
- README 已有中英文与八张介绍图；本次增加 Agent 快速接入入口、可运行的隔离示例和 `llms.txt`。
- 调研开始时 GitHub Release 列表为空；随后已发布 [Windows v0.1.7 安装包、免安装 ZIP 和校验文件](https://github.com/JKZeng-cell/moki-whiteboard/releases/tag/v0.1.7)。本地安装包与 GitHub Release 是不同的交付步骤。
- `package.json` 保留 `private: true`，没有据此宣称可通过 `npx moki-whiteboard` 安装。

## 发现策略：让用户找得到，也能真的用起来

### GitHub 搜索

GitHub 默认仓库搜索主要匹配名称、描述和 Topics；README 内容可通过 `in:readme` 查询。因此先把真实核心能力放在 About 和主题里，再用 README 解释具体场景，而不是单纯重复关键词。[GitHub 搜索说明](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)

已保留原有主题，并补充 `mcp-server`、`model-context-protocol`、`infinite-canvas`、`mind-map`、`ai-agents`、`knowledge-management`、`productivity`。主题用于真实分类，不承诺某个关键词的排名。[GitHub Topics 说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)

### Agent 发现与调用

以 [Agent guide](agent-guide.md) 提供入口、路径、数据共享、版本冲突、准确工具名和可运行示例。MCP `tools/list` 返回英文 + 中文说明，帮助已连接的 Agent 选择工具。`llms.txt` 提供短索引，但它是辅助性提案，不是所有模型必须遵循的标准，也不会让未配置的 Agent 自动获得调用权限。[llms.txt 提案](https://llmstxt.org/)

## 按优先级执行

| 优先级 | 行动 | 完成标准 | 当前边界 |
| --- | --- | --- | --- |
| P0 | 发布可直接下载的 GitHub Release | 安装包、免安装 ZIP、SHA-256、签名说明、清楚的更新记录 | 已发布 v0.1.7；后续版本继续复验产物后发布 |
| P0 | 用一个实际任务解释差异化 | 一句话需求 → Agent 操作 → 可继续编辑的导图 / 虚拟文件夹；配准确配置和截图 | 已有八图，可复用，不虚构聊天内置 AI |
| P1 | 提交合适的 MCP 社区目录 | 符合目录格式、准确类别、可复现安装说明，由维护者审核 | 只准备建议，不自动创建第三方 PR |
| P1 | 准备官方 MCP Registry 分发 | 先有真实可安装产物、所有权验证和准确的服务器元数据 | 不能直接把本机 `127.0.0.1` 填成公共远程服务；npm 包仍为 private |
| P1 | 首次 Show HN / 垂直社区分享 | 可试用、作者能回答问题，聚焦一项真实工作流 | 不自动发帖；不组织互赞或请求朋友投票 |
| P2 | 横版分享封面与独立落地页 | 面向分享与搜索的可访问页面，真实下载 / 文档入口 | 未创建新站、改 DNS 或启用 Pages |
| 持续 | 收集使用案例、修复接入摩擦 | 记录配置失败、首次成功调用、可复用方案；为真实可做任务标注贡献入口 | 不创建空洞 Issue、不承诺增长幅度 |

官方 MCP Registry 只保存元数据，不代为托管分发产物。npm 路线需要先发布实际 npm 包，并按要求添加匹配的 `mcpName` 和 `server.json`。建议先评估拆出轻量 MCP 分发包，避免把桌面 / Office 依赖全部变成 Agent 安装负担；这是待评估方案，不是已完成能力。[Registry 发布指南](https://modelcontextprotocol.io/registry/quickstart)、[包类型与校验](https://modelcontextprotocol.io/registry/package-types)

`awesome-mcp-servers` 的贡献说明要求公开源码、可自行安装运行、简短准确描述和合适分类。先核对当前分类、重复条目及安装体验，再决定是否提交；维护者审核与是否收录不可保证。[目录贡献指南](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md)

Show HN 鼓励分享用户能实际试用的作品，而非只有介绍的页面；也明确不允许请朋友投票。首发应讲作者为什么做、如何实际使用、目前限制是什么，而不是只强调“求 Star”。[Show HN 指南](https://news.ycombinator.com/showhn.html)

GitHub 分享预览图推荐 1280 × 640；现有 3:4 图适合社媒正文，不应直接强行裁成横版。可另做一张横版封面，保留完整界面与一个明确卖点。[GitHub 社交预览说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)

## 可复用投稿文案草稿（尚未发布）

英文标题：

> MOKI Whiteboard — a local-first infinite canvas that MCP agents can actually edit

Show HN 标题草稿：

> Show HN: MOKI Whiteboard, a local-first canvas with editable mind maps over MCP

短介绍：

> I built a standalone whiteboard where an MCP-enabled agent can inspect and edit the same local canvas I use. It supports mind maps, multimedia references, pages, and groups that collapse into virtual folders. The project is MIT-licensed and uses Electron, TypeScript, and SQLite. Models and search come from your own agent; MOKI provides the editable visual workspace.

中文切入点：

> 不止让 AI 给建议，而是让 Agent 把参考素材、思维导图和创意整理真正落到一张还能继续编辑的白板上。

末尾引导保持克制：“如果它对你的工作流有帮助，欢迎 Star 收藏；更想听听你会用它解决什么实际问题。”

## 两周观察方法

先记录基线，再一次只测试一个渠道。观察每周新增自然 Stars、GitHub 独立访客 / clones、有效反馈及首次 MCP 接入成功案例。不把 clone 数当作独立用户，也不直接把新增 Star 归因给某一次曝光；索引延迟、重复访问和其他渠道都会影响结果。

建议第 1–3 天解决下载与接入，第 4–7 天做一次可试用的英文分享与一次中文场景分享，第 8–14 天复盘问题、修复安装摩擦后再申请合适目录收录。没有足够样本时保留观察，不用数字制造增长结论。
