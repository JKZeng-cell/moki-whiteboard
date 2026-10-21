# MOKI bundled UI fonts

MOKI loads these fonts from its own local server. No external font service or
system font installation is required for the UI.

- `Inter-Variable.ttf`: normal Latin UI text, weights 100–900.
- `Inter-Italic-Variable.ttf`: italic Latin text, weights 100–900.
- `NotoSansSC-Variable.ttf`: Chinese UI text, weights 100–900.

The original, unmodified fonts come from the official Google Fonts repository:
https://github.com/google/fonts/tree/main/ofl/inter and
https://github.com/google/fonts/tree/main/ofl/notosanssc.
`SOURCES.json` records the exact source revision, file sizes and SHA-256 hashes.
The corresponding SIL Open Font License files are included in this directory
and distributed with the application.

`src/web/fonts.css` defines the font faces. Vite copies this complete directory
to `dist/web/fonts`, which Electron Builder includes in `app.asar`.
