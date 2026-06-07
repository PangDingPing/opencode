import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "@yejian": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3100,
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:4096",
      "/event": { target: "http://localhost:4096", ws: true },
      "/pty": { target: "http://localhost:4096", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
