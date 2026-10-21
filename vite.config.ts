import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 4320,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4321",'/mcp':'http://127.0.0.1:4321' },
  },
});
