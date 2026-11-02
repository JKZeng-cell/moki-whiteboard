# MOKI 白板应用图标

2026-11-02 · 指形 m 与迎掌手势。

将 m 与 Give me five 的击掌寓意结合：用三段圆润指形暗示 m，掌心留白，在指形与掌弧交接处留两个小断口。紫色品牌底、白色掌心和深紫轮廓，小尺寸优先识别整体手势。

没有画笔、掌心 M、连接节点或回环尾巴。手势表达回应、鼓励和一起创作，不额外堆叠功能符号。

生成方式：内置 `imagegen`。母版保存在 `build/moki-whiteboard-artwork.png`（1254×1254 RGB），构建不依赖 Codex 生成目录或用户临时附件。

## 最终生成提示词

> Refine this MOKI high-five icon according to precise user feedback. Keep the friendly simplified raised hand, soft purple gradient background, gentle tilt, warm white and dark purple graphic colors. REMOVE THE LETTER m FROM THE PALM COMPLETELY. The palm must be plain empty white: absolutely no m, M, text, logo, symbol, pattern or cutout inside it. Instead, make the THREE UPRIGHT ROUNDED FINGER CONTOURS THEMSELVES subtly read as a softly handwritten lowercase m: three upright stems and two rounded connecting rises, with the negative gaps between them providing the letter rhythm. Do not draw a separate letter anywhere. The finger section should feel compact and coherent like the friendly hand reference, not like antennae or elongated tentacles. Simplify the bottom palm into a clean U-shaped outline with an open welcoming thumb on the left. Allow TWO SMALL INTENTIONAL GAPS / BREAKS in the dark-purple contour where the finger section meets the palm curve, so the upper finger-m and the lower palm gesture breathe and feel hand-drawn. Breaks should be neat and deliberate, not distressed or jagged. Avoid a thick solid filled black palm or overinflated blobs. Use clean medium-bold rounded dark-purple strokes with warm-white hand interior and generous negative space. The m should be perceived through the finger silhouette, not literally printed. Keep at most two short friendly high-five motion marks outside the upper-right hand edge, discreet and not attached to the fingers. Main compact palm gesture about 62 percent of canvas, centered with comfortable margins. Flat polished vector-like app icon, calm and friendly, not realistic anatomy, no fingernails, no pen, no tools, no extra nodes or loops, no face, no 3D. OPAQUE full-bleed square purple background to every edge; no external rounded-square boundary or transparent margins because the app pipeline adds its own rounded mask. One final icon, no variant grid, no watermark.

## 导出与使用

运行 `node scripts/build-whiteboard-icon.mjs`，沿用便签图标的 3.125% 留白及圆角比例，在导出时生成透明外缘。

- `public/moki-whiteboard-icon.png`：1024 PNG，管理页、窗口、托盘与网页图标。
- `public/icons/moki-whiteboard-{size}.png`：16、20、24、32、40、48、64、128、256、512、1024 像素。
- `public/moki-whiteboard-icon.ico` / `public/favicon.ico`：16–256 像素的九个图层。
- `docs/showcase/moki-whiteboard-icon.png`：图文预览页资源。
- `docs/design/app-icon-preview.png`：深浅背景与小尺寸预览。
- `docs/design/icon-in-app.png`：当前客户端加载截图。

Windows 和 macOS 打包读取同一套资源，macOS 再用 iconutil 生成 ICNS。安装更新后的客户端后，程序 / Dock 图标会使用新资源。

校验记录见 `icon-validation.json`：透明边缘、九个 ICO 图层、构建资源 / 介绍页资源一致性。未在 Windows 主机上生成 ICNS。
