import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: (() => {
      const backend = "http://127.0.0.1:4096"
      // dev 模式下前端走同源（location.origin），SDK 所有请求经 vite proxy 转发到后端
      // 列出 SDK 用到的所有顶层路径前缀，避免跨域导致 SameSite=Lax cookie 不发送
      const paths = [
        "/api", "/global", "/event", "/config", "/session", "/file", "/find",
        "/path", "/vcs", "/command", "/lsp", "/formatter", "/mcp", "/project",
        "/question", "/permission", "/provider", "/instance", "/agent",
        "/skill", "/log", "/auth", "/experimental", "/doc",
      ]
      const entries = Object.fromEntries(paths.map((p) => [p, backend]))
      // pty 需要 WebSocket 支持
      entries["/pty"] = { target: backend, ws: true }
      return entries
    })(),
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
