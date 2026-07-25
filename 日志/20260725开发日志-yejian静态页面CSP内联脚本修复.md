# 20260725 开发日志 —— `/yejian/` 静态页面 CSP 内联脚本修复

## 需求背景

用户反馈：
- Windows 本地直接打开 `D:\AI\opencode\packages\app\public\yejian\zhuxingtuji.html` 和 `xianxingguifan.html` 时，搜索框输入内容按回车可以正常过滤表格。
- Docker 部署后访问 `http://localhost:8088/yejian/zhuxingtuji.html` 和 `http://localhost:8088/yejian/xianxingguifan.html` 时，搜索框输入内容按回车没有任何反应。

## 问题定位

1. 在浏览器开发者工具中查看 Docker 部署后的响应头，发现：
   ```
   Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...
   ```
2. 两个静态 HTML 页面都包含内联 `<script>` 实现表格搜索过滤。
3. CSP 的 `script-src` 没有 `'unsafe-inline'`，浏览器会阻止这些内联脚本执行，导致搜索功能失效。
4. Windows 本地直接打开文件时没有 CSP 头，所以脚本能正常执行。

## 改动文件

### `packages/opencode/src/server/shared/ui.ts`

- **L15-18**：新增 `YEJIAN_CSP`，在原有 CSP 基础上给 `script-src` 增加 `'unsafe-inline'`。
- **L60-71**：修改 `embeddedUIResponse(file, body, requestPath)`：
  - 如果请求路径以 `yejian/` 开头，则使用 `YEJIAN_CSP`；
  - 否则保持原有 `cspForHtml(...)` 行为，不影响主应用。

## 影响范围

- 仅影响通过 opencode 后端访问 `/yejian/*.html` 的静态页面。
- 不影响主应用（`/`, `/new-session`, `/session/*` 等）的 CSP 策略。

## 踩坑记录

- 不要直接给全局 CSP 加 `'unsafe-inline'`，会降低主应用的安全性；只在 `/yejian/` 静态页面路径下放宽。
- `embeddedUIResponse` 原来没有 `requestPath` 参数，需要同步修改调用方 `serveEmbeddedUIEffect` 传进来。

## 验证步骤

1. 重新构建 Docker 镜像（因为 opencode 二进制里嵌入了后端逻辑，必须重新编译）。
2. 启动容器后访问 `http://localhost:8088/yejian/zhuxingtuji.html`。
3. 在搜索框输入内容并按回车，表格应能正常过滤。
4. 浏览器开发者工具 Network 中查看响应头，确认 `Content-Security-Policy` 包含 `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`。

## commit hash

- `814c8c40d` `fix(yejian): allow inline scripts in CSP for /yejian static pages`
