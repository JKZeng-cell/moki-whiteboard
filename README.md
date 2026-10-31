# MOKI 白板 · MOKI Whiteboard

本地优先、支持 AI Agent 直接读写的开源无限白板与 MCP Server：思维导图、多媒体素材、分页管理、虚拟文件夹。

A local-first, open-source infinite whiteboard and MCP server for AI coding agents: editable mind maps, multimedia assets, pages, and collapsible virtual folders. Built with Electron, React, TypeScript, and SQLite.

[简体中文](#zh-cn) · [English](#english)

[![CI](https://github.com/JKZeng-cell/moki-whiteboard/actions/workflows/ci.yml/badge.svg)](https://github.com/JKZeng-cell/moki-whiteboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6558d3.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.7-30364d.svg)](package.json)

**Agent 接入 / Agent integration:** [MCP quickstart & tool reference](docs/agent-guide.md) · [LLM-readable documentation index](llms.txt) · [8-page visual showcase](docs/showcase/README.md)

适合需要让 Agent 收集参考、整理素材、生成可编辑思维导图或操作本地画布的工作流。MOKI 不内置模型、网页搜索或图片生成服务，这些能力来自你连接的 Agent。

Use MOKI when an agent needs to organize references, edit a mind map, or manipulate a local visual workspace. Models, web search, and image generation are provided by your connected agent, not bundled services.

## Windows 下载 / Windows downloads

Windows x64 · **v0.1.7** · [Release / 更新说明](https://github.com/JKZeng-cell/moki-whiteboard/releases/tag/v0.1.7)

- [安装程序 / Installer (.exe)](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/MOKI-Whiteboard-Setup-0.1.7-x64.exe)
- [免安装包 / Portable ZIP](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/MOKI-Whiteboard-0.1.7-Windows-x64.zip)
- [SHA-256 校验 / Checksums](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/SHA256SUMS-0.1.7.txt)

安装包尚未代码签名，Windows 可能显示未知发布者或 SmartScreen 提示。请核对下载文件的 SHA-256。 / Packages are not code-signed; Windows may show an unknown-publisher or SmartScreen warning. Verify the SHA-256 checksum before running.

<a id="macos-downloads"></a>

## macOS 下载 / macOS downloads

Apple Silicon（arm64）· **v0.1.7** · [Release / 更新说明](https://github.com/JKZeng-cell/moki-whiteboard/releases/tag/v0.1.7)

- [DMG 安装包 / Installer](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/MOKI-Whiteboard-0.1.7-macOS-arm64.dmg)
- [完整应用 ZIP / App ZIP](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/MOKI-Whiteboard-0.1.7-macOS-arm64.zip)
- [SHA-256 校验 / Checksums](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/SHA256SUMS-0.1.7-macOS-arm64.txt)

仅支持 Apple Silicon，暂不支持 Intel Mac。当前应用为 ad-hoc 签名，未进行 Developer ID 签名和 Apple 公证；首次打开受阻时，请看[中文处理步骤](#macos-first-launch)。 / Apple Silicon only; Intel Macs are unavailable. The app is ad-hoc signed, without Developer ID signing or Apple notarization. See [first-launch help](#macos-first-launch-en) if macOS blocks it.

<a id="zh-cn"></a>

MOKI 白板从 MOKI 工作台的无限白板能力演化而来，提供独立的 React / Electron 应用、本地 SQLite 存储和标准 MCP Server。你可以自己编辑画布，也可以让支持 MCP 的 Agent 读取、创建、修改、对齐和导出白板内容。

![MOKI 白板管理页](docs/assets/screenshots/board-manager.png)

## 为什么做这个项目

- **本地优先**：白板数据库和素材默认保存在自己的电脑中。
- **Agent 真正可操作**：不是旁边放一个聊天框，而是通过 MCP 直接读写画布对象。
- **完整无限画布**：便签、文本、图形、钢笔、思维导图、图片、文件和网页卡片在同一套交互中工作。
- **文件可迁移**：通过 `.moki` 文件在独立白板与 MOKI 工作台之间双向迁移页面和素材。

| 浅色画布 | 深色画布 |
| --- | --- |
| ![浅色画布](docs/assets/screenshots/canvas-light.png) | ![深色画布](docs/assets/screenshots/canvas-dark.png) |

## 图文介绍

[查看八张发布介绍图与中英双语预览页](docs/showcase/README.md)，了解多媒体置入、思维导图、分页管理、素材管理、虚拟文件夹与 MCP Agent 协作。

## 主要能力

- 白板管理：新建、搜索、重命名、复制、删除，以及上次编辑内容缩略图；进入编辑页后显示当前白板名称。
- 无限画布：连续无级缩放、平移、适应内容、缩略图导航与全屏。
- 内容工具：便签、文本、六类图形、四种箭头、四档画笔、贝塞尔钢笔路径、9 类思维导图模板、图片 / GIF / 视频、文件和链接。
- 编辑交互：多选、旋转、角点缩放、边缘拉伸、编组 / 资料夹、对齐 / 分布、剪贴板、撤销 / 重做和就地文本编辑。
- 分组整理：将相关内容编组，收起为画布中的虚拟文件夹（资料夹）；需要时再展开，分组管理整洁有序。
- 页面系统：多页面、页面分组、跨页面内容检索与定位、页面历史版本和恢复。
- 本地资料：文件 / 文件夹插入、素材列表、预览与重命名，可自定义素材缓存路径。
- 外观：浅色、深色和跟随系统。
- 文件互通：支持 v2 `.moki` ZIP，并兼容旧 `.moki-board`、封装 JSON 和原始快照。
- 安全写入：SQLite WAL、乐观版本冲突保护、操作审计和异常剪贴板原子校验。

## MCP 与 Agent

MOKI 白板提供标准 stdio 和 Streamable HTTP 两种 MCP 连接方式，共 16 个工具，并提供 Resource 与 Prompt。

![MCP 设置](docs/assets/screenshots/mcp-settings.png)

代表性工具：

| 工具 | 能力 |
| --- | --- |
| `whiteboard_list` | 列出白板 |
| `whiteboard_inspect` | 读取页面、元素、文本、位置和 ID |
| `whiteboard_add_elements` | 添加便签、文本、图形、箭头、笔迹、思维导图、图片、文件和链接 |
| `whiteboard_update_elements` | 修改内容、位置、尺寸、颜色、样式和旋转 |
| `whiteboard_align_elements` | 对齐或等距分布元素 |
| `whiteboard_manage_pages` | 查询、重命名、分组或删除页面 |
| `whiteboard_export` | 导出完整 `.moki` 白板 |
| `whiteboard_native_edit` | 原生属性、编组、资料夹和思维导图层级操作 |

推荐 Agent 流程：

1. `whiteboard_list`
2. `whiteboard_inspect`
3. 使用返回的准确 ID 和 `expectedVersion` 修改
4. 再次 inspect 验证结果

版本冲突会返回 `VERSION_CONFLICT`，不会静默覆盖较新的白板内容。HTTP MCP 默认仅用于本机；不要直接暴露到公网。需要本机认证时可设置 `MOKI_WHITEBOARD_MCP_TOKEN`。

## 快速开始

需要 Node.js 22.5 或更高版本，推荐当前 LTS。

```powershell
git clone https://github.com/JKZeng-cell/moki-whiteboard.git
cd moki-whiteboard
npm ci
npm run dev
```

浏览器界面默认位于 `http://127.0.0.1:4320`，API 位于 `http://127.0.0.1:4321`，开发数据库位于 `data/moki-whiteboard.db`。

运行桌面客户端：

```powershell
npm run desktop
```

验证全部类型、测试和生产构建：

```powershell
npm run check
npm run test:mcp:stdio
```

## MCP 配置

先运行 `npm run build`，再将绝对路径替换成你的克隆目录：

```json
{
  "mcpServers": {
    "moki-whiteboard": {
      "command": "node",
      "args": ["D:/path/to/moki-whiteboard/dist/mcp/server.js"],
      "env": {
        "MOKI_WHITEBOARD_DATA": "D:/path/to/moki-whiteboard/data/moki-whiteboard.db"
      }
    }
  }
}
```

也可以在应用设置中切换到 Streamable HTTP，并复制当前本机地址。不同 Agent 客户端的配置文件结构可能不同，MCP 规范不统一规定客户端配置文件键名。

## Windows 打包

Windows 上执行：

```powershell
npm run desktop:dist
```

脚本会创建新的 `release-build-*` 目录并生成 x64 NSIS 安装包与完整免安装 ZIP，不覆盖已有产物。桌面数据默认保存在 `%APPDATA%/moki-whiteboard`，卸载不会主动删除用户数据库。

当前项目的 Windows 安装包尚未进行代码签名，可能出现未知发布者或 SmartScreen 提示。请只从项目 Release 或明确的官方渠道下载，并核对 SHA-256。

## macOS 打包

当前支持 Apple Silicon（arm64），请在对应架构的 Mac 上构建：

```bash
npm ci
npm run desktop:dist:mac
```

已发布的 DMG、ZIP 和校验文件可从[上方下载区](#macos-downloads)或 [GitHub Release](https://github.com/JKZeng-cell/moki-whiteboard/releases/tag/v0.1.7) 获取。自行构建也可手动运行 [macOS Packages 工作流](https://github.com/JKZeng-cell/moki-whiteboard/actions/workflows/macos-packages.yml)；其原生构建及客户端 / MCP 验证产物保存为 Actions 附件 30 天，不自动发布到 Release。维护者通过独立发布工作流核对来源和哈希后再发布已验证产物。Intel Mac 暂不提供安装包：当前 Office 公式引擎不支持 `darwin-x64`。

Mac 数据默认在 `~/Library/Application Support/moki-whiteboard`，素材缓存位于其中的 `whiteboard-materials`，与 `.app` 包隔离；可在设置中更改缓存路径。当前构建不使用 Developer ID 签名或 Apple 公证，不能视为 Gatekeeper 已认可的正式签名包。

<a id="macos-first-launch"></a>

### macOS 首次打开：无法验证开发者或无法打开

1. 从本仓库 Release 下载 DMG，将应用拖入“应用程序”（Applications）；使用 ZIP 时先完整解压并移动 `.app`，不要在 DMG 或压缩包中直接运行。
2. 核对下载文件的 SHA-256，例如在“终端”运行：

```bash
shasum -a 256 ~/Downloads/MOKI-Whiteboard-0.1.7-macOS-arm64.dmg
```

本次 DMG 的结果应为 `7dda1998c9b6f052326920e1b975e0aaafbe913db5c870a397e235ca3cec97f7`；ZIP 的校验值见下载区的 SHA-256 文件。

3. 尝试打开一次应用。若提示“无法验证开发者”或“Apple 无法验证此 App 是否包含恶意软件”，关闭提示，再前往 **系统设置 → 隐私与安全性 → 安全性 → 仍要打开**，按提示认证并确认打开。Apple 的[官方说明](https://support.apple.com/zh-cn/102445)介绍了这个单个应用例外。

<details>
<summary>已核对来源和哈希，仍因下载隔离标记无法打开？</summary>

仅在你确认信任该下载、校验值一致，且上述方法仍不能解除下载隔离时，可在终端对已安装的这一份应用执行：

```bash
xattr -dr com.apple.quarantine "/Applications/MOKI Whiteboard.app"
```

此命令仅移除指定应用的下载隔离属性，不会补上开发者认证或公证，也不能修复实际损坏。应用如被重命名或安装在其他位置，请将 Finder 中的应用拖入终端替换路径；遇到权限拒绝时请检查安装位置和账户权限。`xattr` 参数可查阅 [Apple 开源手册](https://github.com/apple-oss-distributions/file_cmds/blob/main/xattr/xattr.1)。无需关闭 Gatekeeper 或 SIP。

</details>

若提示文件“已损坏”，先重新下载并检查哈希，不要直接认定是缺少认证；若提示“将损坏你的电脑”、被识别为恶意软件或校验失败，请停止运行。受管理的 Mac 若没有“仍要打开”选项，请联系管理员。以上步骤不能修复 Intel 架构不支持、文件损坏或其他运行错误；仍有问题时请提交 macOS 版本、芯片类型和完整报错。原生构建验收不等同于已在所有 macOS 上人工验证浏览器下载后的 Gatekeeper 弹窗。

## 项目结构

```text
src/core/         白板快照、页面与元素模型
src/server/       SQLite 存储和本地 HTTP API
src/mcp/          标准 MCP Server
src/web/          React 管理页与应用入口
src/desktop/      Electron 桌面外壳
src/vendor/moki/  无限白板、思维导图、文件归档和预览组件
tests/            核心、API 和 MCP 协议测试
docs/             截图与发布资料
```

## 数据与隐私

- 项目不会把 `data/`、素材缓存、安装包或构建产物提交到 Git。
- `.moki`、SQLite 数据库和素材缓存可能包含用户内容，公开分享前请自行检查。
- 浏览器不能直接调用部分系统能力；文件夹选择、默认应用和本机文件打开由 Electron 桥接完成。
- 应用不内置模型账号。Agent 能力来自你自行连接的 MCP 客户端。

## 参与贡献

欢迎 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

如果这个项目对你有帮助，欢迎 Star 收藏，让更多创作者和 Agent 开发者发现它。也欢迎分享你的实际使用场景。

## License

[MIT](LICENSE) © 2026 JKZeng

---

## English

[Back to 简体中文](#zh-cn)

MOKI Whiteboard is a standalone React / Electron application evolved from the infinite whiteboard in MOKI Workbench. It combines a local SQLite database with a standard MCP server. Edit the canvas yourself, or let an MCP-enabled agent inspect, create, update, align, and export its contents.

![MOKI Whiteboard manager](docs/assets/screenshots/board-manager.png)

### Why MOKI Whiteboard?

- **Local-first:** board databases and assets are stored on your computer by default.
- **Agents can actually edit:** MCP provides direct access to canvas objects, rather than just a chat panel beside the board.
- **One infinite canvas:** combine sticky notes, text, shapes, pen paths, mind maps, images, files, and web cards.
- **Portable boards:** move pages and assets between MOKI Whiteboard and MOKI Workbench using `.moki` files.

| Light canvas | Dark canvas |
| --- | --- |
| ![Light canvas](docs/assets/screenshots/canvas-light.png) | ![Dark canvas](docs/assets/screenshots/canvas-dark.png) |

### Visual Showcase

[Explore all eight launch images and the bilingual preview page](docs/showcase/README.md): multimedia, mind maps, pages, asset management, virtual folders, and MCP agent collaboration.

### Features

- Board management: create, search, rename, duplicate, delete, and view thumbnails from the last editing session. The editor header shows the current board name.
- Infinite canvas: continuous zoom, pan, fit to content, minimap navigation, and fullscreen.
- Creation tools: sticky notes, text, six shape types, four arrow styles, four brush sizes, Bézier pen paths, nine mind-map templates, images / GIFs / videos, files, and links.
- Editing: multi-select, rotation, corner scaling, edge resizing, groups / folders, alignment / distribution, clipboard, undo / redo, and inline text editing.
- Group organization: group related content and collapse it into a virtual folder on the canvas. Expand it when needed to keep your workspace tidy and organized.
- Pages: multiple pages, page groups, cross-page content search and navigation, and per-page version history and restoration.
- Local assets: insert files / folders, locate and preview assets, rename them, and configure the asset-cache directory.
- Appearance: light, dark, or follow the system theme.
- Interoperability: v2 `.moki` ZIP archives, legacy `.moki-board` files, wrapped JSON, and raw snapshots.
- Safer writes: SQLite WAL, optimistic version-conflict protection, operation auditing, and atomic clipboard validation.

### MCP and Agents

MOKI Whiteboard supports standard stdio and Streamable HTTP MCP transports, with 16 tools plus MCP resources and prompts.

![MCP settings](docs/assets/screenshots/mcp-settings.png)

Representative tools:

| Tool | Capability |
| --- | --- |
| `whiteboard_list` | List boards |
| `whiteboard_inspect` | Read pages, elements, text, positions, and IDs |
| `whiteboard_add_elements` | Add notes, text, shapes, arrows, strokes, mind maps, images, files, and links |
| `whiteboard_update_elements` | Update content, position, dimensions, colors, styles, and rotation |
| `whiteboard_align_elements` | Align elements or distribute them evenly |
| `whiteboard_manage_pages` | Query, rename, group, or delete pages |
| `whiteboard_export` | Export a complete `.moki` board |
| `whiteboard_native_edit` | Edit native properties, groups, folders, and mind-map hierarchy |

Recommended workflow:

1. Call `whiteboard_list`.
2. Call `whiteboard_inspect`.
3. Make changes using the exact returned IDs and `expectedVersion`.
4. Inspect again to verify the result.

Conflicting writes return `VERSION_CONFLICT` rather than silently overwriting newer content. HTTP MCP is intended for local use by default; do not expose it directly to the public internet. Set `MOKI_WHITEBOARD_MCP_TOKEN` if local authentication is required.

### Quick Start

Requires Node.js 22.5 or newer; a current LTS version is recommended.

```powershell
git clone https://github.com/JKZeng-cell/moki-whiteboard.git
cd moki-whiteboard
npm ci
npm run dev
```

The development UI defaults to `http://127.0.0.1:4320`, the API to `http://127.0.0.1:4321`, and the database to `data/moki-whiteboard.db`.

Run the desktop app:

```powershell
npm run desktop
```

Run type checks, tests, the production build, and the stdio MCP smoke test:

```powershell
npm run check
npm run test:mcp:stdio
```

### MCP Configuration

Run `npm run build` first, then replace these absolute paths with your clone location:

```json
{
  "mcpServers": {
    "moki-whiteboard": {
      "command": "node",
      "args": ["D:/path/to/moki-whiteboard/dist/mcp/server.js"],
      "env": {
        "MOKI_WHITEBOARD_DATA": "D:/path/to/moki-whiteboard/data/moki-whiteboard.db"
      }
    }
  }
}
```

Alternatively, select Streamable HTTP in the app settings and copy the local connection configuration. Agent clients may use different configuration-file structures; the MCP specification does not prescribe client configuration keys.

### Windows Packaging

Run on Windows:

```powershell
npm run desktop:dist
```

The script creates a fresh `release-build-*` directory containing an x64 NSIS installer and a complete portable ZIP, without overwriting previous build directories. Desktop data defaults to `%APPDATA%/moki-whiteboard`; uninstalling does not deliberately delete the user database.

Windows packages are currently **not code-signed**. Windows may show an unknown-publisher or SmartScreen warning. Download only from this project's Releases or a clearly identified official channel, and verify the SHA-256 checksum.

### macOS Packaging

Build on an Apple Silicon (arm64) Mac:

```bash
npm ci
npm run desktop:dist:mac
```

Published DMG / ZIP downloads and checksums are available in the [download section](#macos-downloads) and [GitHub Release](https://github.com/JKZeng-cell/moki-whiteboard/releases/tag/v0.1.7). For your own builds, manually run [macOS Packages](https://github.com/JKZeng-cell/moki-whiteboard/actions/workflows/macos-packages.yml): the native arm64 runner verifies the extracted app and MCP integration, then retains artifacts for 30 days without automatic publication. Maintainers publish verified artifacts separately after checking provenance and hashes. Intel Mac packages are unavailable because the bundled Office formula engine does not support `darwin-x64`.

Data defaults to `~/Library/Application Support/moki-whiteboard`; the default asset cache is its `whiteboard-materials` subdirectory, outside the `.app` bundle. The cache path remains configurable. These builds are not Developer ID-signed or Apple-notarized; do not treat them as Gatekeeper-approved distribution builds.

<a id="macos-first-launch-en"></a>

### First launch: unidentified developer or blocked app

1. Download from this repository's Release. Drag the app from the DMG to Applications, or fully extract the ZIP and move the `.app` there before launching.
2. Verify the downloaded file, for example:

```bash
shasum -a 256 ~/Downloads/MOKI-Whiteboard-0.1.7-macOS-arm64.dmg
```

The DMG hash is `7dda1998c9b6f052326920e1b975e0aaafbe913db5c870a397e235ca3cec97f7`. ZIP checksums are in the linked checksum file.

3. Try opening the app once. For an unidentified-developer or unverifiable-app alert, dismiss it, then go to **System Settings → Privacy & Security → Security → Open Anyway**. Authenticate and confirm opening. See [Apple's instructions](https://support.apple.com/en-us/102445).

<details>
<summary>Verified download still blocked by its quarantine attribute?</summary>

Only if you trust the source, the checksum matches, and the settings route has not resolved the download-quarantine restriction, you can remove that attribute from this installed app:

```bash
xattr -dr com.apple.quarantine "/Applications/MOKI Whiteboard.app"
```

This affects only the named app; it does not add certification, notarize the app, or repair damage. If you renamed or moved the app, drag it from Finder into Terminal to supply the actual path. For permission errors, check the installation location and account permissions. The flags are documented in [Apple's xattr manual](https://github.com/apple-oss-distributions/file_cmds/blob/main/xattr/xattr.1). No global Gatekeeper or SIP change is needed.

</details>

For a damaged-file alert, download again and check the hash first; do not assume every failure is a signing issue. Stop if the checksum differs or macOS reports malware / harm to your computer. On a managed Mac, ask your administrator if Open Anyway is unavailable. These steps cannot fix Intel incompatibility, damaged files, or unrelated crashes. Report your macOS version, chip, and exact error if problems persist. Native build checks do not constitute manual testing of every browser-download Gatekeeper prompt.

### Project Structure

```text
src/core/         Board snapshots, pages, and element models
src/server/       SQLite storage and local HTTP API
src/mcp/          Standard MCP server
src/web/          React board manager and app entry point
src/desktop/      Electron desktop shell
src/vendor/moki/  Canvas, mind maps, archives, and preview components
tests/            Core, API, and MCP protocol tests
docs/             Screenshots and release materials
```

### Data and Privacy

- `data/`, asset caches, installers, and build outputs are excluded from Git.
- `.moki` archives, SQLite databases, and asset caches may contain user content. Review them before sharing publicly.
- Some OS features are unavailable in a browser. Folder selection, default applications, and local-file opening use the Electron bridge.
- No model account is bundled. Agent capabilities come from the MCP client you connect.

### Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Report security issues privately as described in [SECURITY.md](SECURITY.md).

If MOKI helps your workflow, consider starring the repository so other creators and agent developers can discover it. Real use cases and feedback are especially welcome.

### License

[MIT](LICENSE) © 2026 JKZeng
