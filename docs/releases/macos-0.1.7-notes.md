<!-- macos-arm64-0.1.7 -->
## macOS Apple Silicon / 苹果芯片版

- [DMG 安装包 / Installer](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/MOKI-Whiteboard-0.1.7-macOS-arm64.dmg)
- [完整应用 ZIP / App ZIP](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/MOKI-Whiteboard-0.1.7-macOS-arm64.zip)
- [SHA-256 校验 / Checksums](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/SHA256SUMS-0.1.7-macOS-arm64.txt)
- [成品验收报告 / Verification report](https://github.com/JKZeng-cell/moki-whiteboard/releases/download/v0.1.7/macOS-0.1.7-arm64-verification.json)

版本保持 **0.1.7**，新增 macOS Apple Silicon（arm64）安装包。将 DMG 内的应用拖入 Applications，或完整解压 ZIP 后移动应用。Intel Mac 暂不支持：Office 公式引擎依赖缺少 `darwin-x64` 支持。

Version remains **0.1.7**. These packages target Apple Silicon (arm64). Drag the app from the DMG to Applications, or fully extract the ZIP and move the app. Intel Macs are unavailable because the Office formula-engine dependency does not support `darwin-x64`.

**首次打开 / First launch:** 本包为 ad-hoc 签名，未进行 Developer ID 签名或 Apple 公证。出现无法验证开发者等提示时，按 README 的[中文处理步骤](https://github.com/JKZeng-cell/moki-whiteboard#macos-first-launch)或 [English instructions](https://github.com/JKZeng-cell/moki-whiteboard#macos-first-launch-en)操作。仅为已核对 SHA-256 且确认可信的应用授予单个应用例外，无需关闭系统安全保护。The app is ad-hoc signed, without Developer ID signing or Apple notarization; follow the linked instructions if macOS blocks first launch.

macOS source: `8a5339132a1bf351be65b47bb4b94578d362eae1`; [native build](https://github.com/JKZeng-cell/moki-whiteboard/actions/runs/41214263876) on macOS 15.8.2. Type checking, production build, 23 test files / 260 tests, Agent example, DMG / ZIP integrity, extracted-app startup / settings / file import, Office viewer, and 16 MCP tools passed. Downloaded-browser Gatekeeper prompts and clean-machine installation have not been manually verified. Earlier source / validation details above refer to the Windows packages; those assets are unchanged.
