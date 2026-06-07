# 广东冶建 AI 工作台定制 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 opencode fork 上以最小侵入方式构建定制 Web 工作台，Docker 双容器部署，原版 opencode 几乎不动便于跟随上游。

**Architecture:** 独立 Vite + SolidJS 应用置于 `yejian/`，复用 `@opencode-ai/app` 已导出的 region 组件（MessageTimeline / SessionComposerRegion / SessionReviewTab / TerminalPanel）；nginx + opencode-ai@1.16.2 容器编排在 `docker/`；packages/* 仅 file-tree.tsx 与 index.ts 共 2 处微改。

**Tech Stack:** Bun 1.3+ / SolidJS / Vite / TypeScript / @solidjs/router / Tailwind / @opencode-ai/sdk / nginx:alpine / oven/bun:1.3-alpine / docker compose v2

**Spec:** [docs/superpowers/specs/2026-06-07-yejian-customization-design.md](../specs/2026-06-07-yejian-customization-design.md)

**Branch:** 所有任务在 `yejian-main` 分支执行。每个任务一次提交，提交后 `git push origin yejian-main`。

---

## 阶段总览

| 阶段 | 任务 | 产出 |
|---|---|---|
| 0 准备 | Task 0 | 验证开发环境、确认基线 |
| 1 上游打开口子 | Task 1 | packages/app re-export + file-tree 过滤 |
| 2 yejian 项目搭骨架 | Task 2-4 | 独立 Vite 应用能跑起来连上 opencode |
| 3 业务面板 | Task 5-7 | PanelOne / PanelTwo / SessionPage 组合 |
| 4 Docker 部署 | Task 8-11 | 镜像 + compose + 一键脚本 |
| 5 端到端联调 | Task 12 | 在 Docker 中走通完整用户路径 |

---

## Task 0：准备工作与基线验证

**目的：** 确认环境就绪，记录基线状态。

**Files:**
- Read: `packages/app/package.json`、`packages/opencode/package.json`

- [ ] **Step 1: 确认 Bun 版本 ≥ 1.3.14**

```bash
bun --version
```

预期：≥ `1.3.14`。低于则按 https://bun.sh 安装升级。

- [ ] **Step 2: 确认 Docker 版本 ≥ 24，Docker Compose v2**

```bash
docker --version
docker compose version
```

预期：docker ≥ 24，compose 是 v2（命令为 `docker compose` 而非 `docker-compose`）。

- [ ] **Step 3: 确认当前在 yejian-main 分支**

```bash
cd D:/ai/opencode
git branch --show-current
```

预期输出：`yejian-main`。不是的话执行 `git checkout yejian-main`。

- [ ] **Step 4: 确认原版 packages/app 当前能跑（基线）**

```bash
cd D:/ai/opencode
bun install
```

预期：依赖安装完成，无致命错误。

```bash
cd D:/ai/opencode/packages/app
bun dev
```

预期：vite 在 http://localhost:3000 启动。浏览器打开看到 opencode 原版界面（要先有 opencode-server 在 4096 端口运行，否则会显示连接错）。`Ctrl+C` 退出。

> 这一步是基线快照。后面所有改动后都要回来确认这一步仍能跑。

---

## Task 1：上游侵入式改动（file-tree 过滤 + 打开 region 导出）

**目的：** 用尽量少的 packages/* 改动支撑 yejian。本任务只动 2 个文件。

**Files:**
- Modify: `packages/app/src/components/file-tree.tsx`（约 1 行）
- Modify: `packages/app/src/index.ts`（追加约 6 行）

- [ ] **Step 1: 看 file-tree.tsx 当前 nodes() 函数**

```bash
cd D:/ai/opencode
sed -n '320,360p' packages/app/src/components/file-tree.tsx
```

预期看到 `const nodes = createMemo(() => { ... })` 函数体，里面有 `const out = nodes.filter(...)` 或类似过滤。

- [ ] **Step 2: 在 file-tree.tsx 添加过滤**

找到 `const out = ` 这一行下面的过滤链尾部（约第 343 行），在最后再追加一个 filter。整段类似：

```ts
// packages/app/src/components/file-tree.tsx 第 343 行附近
const out = nodes
  .filter(/* 原有过滤 */)
  .filter((n) => !n.name.startsWith(".")) // ← 新增：隐藏 . 开头目录与文件
```

如果原代码是显式 for/if 形式，则在 push 到 out 之前加判断 `if (n.name.startsWith(".")) continue;`。

第 350-374 行 `current.dirs/files` 合并循环：若该循环把结果 push 到另一个数组，也在 push 前加同样判断。

> 注：实际代码风格可能与示例不同，按文件内现有过滤的写法保持一致即可。

- [ ] **Step 3: 在 packages/app/src/index.ts 末尾追加 region re-export + 上下文 hooks**

```ts
// packages/app/src/index.ts 末尾追加
export { MessageTimeline } from "./pages/session/message-timeline"
export {
  SessionComposerRegion,
  createSessionComposerState,
} from "./pages/session/composer"
export { SessionReviewTab } from "./pages/session/review-tab"
export { SessionSidePanel } from "./pages/session/session-side-panel"
export { TerminalPanel } from "./pages/session/terminal-panel"
// yejian 需要的 context hooks
export { useSDK } from "./context/sdk"
export { useSync } from "./context/sync"
export { useFile } from "./context/file"
```

实施期需先 Read 这些文件确认每个 hook 的真实导出名（如 `useSDK` 可能叫 `useSdkContext` 或别的）；若有差异按真实名 export。

- [ ] **Step 4: 验证 packages/app 仍能 typecheck**

```bash
cd D:/ai/opencode/packages/app
bun typecheck
```

预期：无 error。若 export 路径不存在，调整为实际路径（如 `./pages/session/composer/index`）。

- [ ] **Step 5: 验证原版仍能跑**

```bash
cd D:/ai/opencode/packages/app
bun dev
```

浏览器打开 http://localhost:3000，确认界面正常，文件树里如果原本有 `.opencode/`、`.git/` 之类已经看不见。`Ctrl+C` 退出。

- [ ] **Step 6: Commit**

```bash
cd D:/ai/opencode
git add packages/app/src/components/file-tree.tsx packages/app/src/index.ts
git commit -m "feat(app): 隐藏 . 前缀文件树节点并暴露 session region 组件供 yejian 复用"
git push origin yejian-main
```

---

## Task 2：yejian 项目骨架（package.json + Vite + TS 配置）

**目的：** 建一个空 Vite + SolidJS 项目，与 monorepo 集成。

**Files:**
- Create: `yejian/package.json`
- Create: `yejian/tsconfig.json`
- Create: `yejian/vite.config.ts`
- Create: `yejian/index.html`
- Create: `yejian/src/entry.tsx`
- Create: `yejian/src/App.tsx`（占位）

- [ ] **Step 1: 创建 yejian 目录结构**

```bash
cd D:/ai/opencode
mkdir -p yejian/src/{pages,components,config,hooks,utils}
```

- [ ] **Step 2: 写 yejian/package.json**

```json
{
  "name": "@yejian/web",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173",
    "typecheck": "tsgo -b"
  },
  "dependencies": {
    "@opencode-ai/app": "workspace:*",
    "@opencode-ai/sdk": "workspace:*",
    "@opencode-ai/ui": "workspace:*",
    "@solidjs/router": "catalog:",
    "@solidjs/meta": "catalog:",
    "solid-js": "catalog:"
  },
  "devDependencies": {
    "@tsconfig/bun": "1.0.9",
    "@types/bun": "catalog:",
    "@types/node": "catalog:",
    "@typescript/native-preview": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vite-plugin-solid": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "tailwindcss": "catalog:"
  }
}
```

- [ ] **Step 3: 写 yejian/tsconfig.json**

```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ES2022",
    "noEmit": false,
    "emitDeclarationOnly": true,
    "declaration": true,
    "outDir": "./ts-dist",
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "@yejian/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: 写 yejian/vite.config.ts**

```ts
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
```

- [ ] **Step 5: 写 yejian/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>广东冶建施工图审查中心AI工作台</title>
  <meta name="x-user" content="__USER__" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/entry.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: 写 yejian/src/entry.tsx（占位空壳）**

```tsx
import { render } from "solid-js/web"
import App from "./App"
import "@opencode-ai/app/index.css"

const root = document.getElementById("root")
if (!root) throw new Error("根节点 #root 未找到")
render(() => <App />, root)
```

- [ ] **Step 7: 写 yejian/src/App.tsx（占位）**

```tsx
/**
 * 顶层应用组件占位。
 * 用途：在 Task 3 引入 Provider 链与路由后，这里将组装 Provider 与 Router。
 * 入参：无
 * 返回：JSX 根节点
 */
export default function App() {
  return (
    <div style={{ padding: "20px", "font-family": "system-ui, sans-serif" }}>
      <h1>广东冶建施工图审查中心 AI 工作台</h1>
      <p>骨架已就绪，等待接入 opencode 上下文…</p>
    </div>
  )
}
```

- [ ] **Step 8: 装依赖、确认 workspace 识别**

```bash
cd D:/ai/opencode
bun install
```

预期：`@yejian/web` 被识别为 workspace 成员，依赖完成。

- [ ] **Step 9: 跑 dev server**

```bash
cd D:/ai/opencode/yejian
bun dev
```

预期：vite 在 http://localhost:3100 启动。浏览器打开看到中文标题和占位文字。

- [ ] **Step 10: 跑 typecheck**

```bash
cd D:/ai/opencode/yejian
bun typecheck
```

预期：无 error。

- [ ] **Step 11: Commit**

```bash
cd D:/ai/opencode
git add yejian/
git commit -m "feat(yejian): 初始化 Vite + SolidJS 项目骨架"
git push origin yejian-main
```

---

## Task 3：接入 opencode Provider 链与路由

**目的：** 让 yejian 能用 `@opencode-ai/app` 的上下文（SDK、Sync、File、Terminal），并定义路由 `/yejian/:dir/session/:id?`。

**Files:**
- Modify: `yejian/src/App.tsx`
- Create: `yejian/src/pages/SessionPage.tsx`（占位 SessionPage，下个任务做真布局）

- [ ] **Step 1: 验证 packages/app 暴露了所需 Provider**

```bash
cd D:/ai/opencode
grep -n "AppBaseProviders\|PlatformProvider\|ServerConnection" packages/app/src/index.ts
```

预期：能找到对应 export。`AppBaseProviders`、`PlatformProvider`、`ServerConnection` 三个都要存在。

- [ ] **Step 2: 重写 yejian/src/App.tsx**

```tsx
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider, Title } from "@solidjs/meta"
import { AppBaseProviders, PlatformProvider, ServerConnection } from "@opencode-ai/app"
import SessionPage from "./pages/SessionPage"

/**
 * 顶层应用组件。
 * 用途：组装路由、Provider 链与全局 Title。
 * 入参：无
 * 返回：完整 SolidJS 应用根
 */
export default function App() {
  const platform = {
    backend: "browser" as const,
    isDesktop: false,
    isMobile: false,
  }
  const server: ServerConnection = {
    url: window.location.origin, // 同源；dev 模式下走 vite proxy
  }

  return (
    <MetaProvider>
      <Title>广东冶建施工图审查中心AI工作台</Title>
      <PlatformProvider value={platform as any}>
        <AppBaseProviders server={server}>
          <Router>
            <Route path="/" component={() => <Navigate href="/yejian" />} />
            <Route path="/yejian" component={SessionPage} />
            <Route path="/yejian/:dir" component={SessionPage} />
            <Route path="/yejian/:dir/session/:id?" component={SessionPage} />
          </Router>
        </AppBaseProviders>
      </PlatformProvider>
    </MetaProvider>
  )
}
```

> **注意**：`PlatformProvider`、`ServerConnection`、`AppBaseProviders` 的真实签名可能与示例不同。**实施前先 Read `packages/app/src/app.tsx` 看 AppBaseProviders 的入参，按真实签名调整**。这是 Task 3 的隐藏前置。如果 AppBaseProviders 不接受 `server` 直接 prop，则把 ServerConnection 放到外层（参考 packages/app/src/entry.tsx 的写法）。

- [ ] **Step 3: 写占位 SessionPage**

```tsx
// yejian/src/pages/SessionPage.tsx
import { useParams } from "@solidjs/router"

/**
 * Session 页面占位实现。
 * 用途：在 Task 4-7 替换为真实四列布局；本任务只验证 Provider 链通了。
 * 入参：路由 :dir 与 :id（base64 编码的目录路径与 session id）
 * 返回：占位 JSX
 */
export default function SessionPage() {
  const params = useParams()
  return (
    <div style={{ padding: "20px" }}>
      <h2>SessionPage 占位</h2>
      <p>dir = {params.dir ?? "(未指定)"}</p>
      <p>id = {params.id ?? "(未指定)"}</p>
    </div>
  )
}
```

- [ ] **Step 4: 启动后端 opencode-server（开发环境）**

打开**第二个终端**：

```bash
cd D:/AI/AIworkbench    # 或任意你想作为 workspace 的目录
opencode serve --port 4096
```

预期：opencode server 在 4096 端口起来。如果没装 opencode CLI：

```bash
bun add -g opencode-ai@1.16.2
```

- [ ] **Step 5: 跑 yejian dev**

```bash
cd D:/ai/opencode/yejian
bun dev
```

打开 http://localhost:3100/yejian，应自动跳到 `/yejian`，再访问 `/yejian/dGVzdA==/session/`（dir 为 base64 的 "test"）应看到占位 SessionPage 渲染参数。

浏览器 devtools 的 Network 标签：访问页面时应有走 `/api/*` 的请求成功（200，不是 502/connection refused）。这说明 vite proxy 转发到 opencode-server 工作正常。

- [ ] **Step 6: typecheck**

```bash
cd D:/ai/opencode/yejian && bun typecheck
```

预期：无 error。

- [ ] **Step 7: Commit**

```bash
cd D:/ai/opencode
git add yejian/
git commit -m "feat(yejian): 接入 opencode Provider 链与路由骨架"
git push origin yejian-main
```

---

## Task 4：技能配置 + 通用工具

**目的：** 把所有"数据来源"先准备好，后续 UI 任务才能聚焦渲染。

**Files:**
- Create: `yejian/src/config/skills.json`
- Create: `yejian/src/config/app.ts`
- Create: `yejian/src/utils/phoneMask.ts`
- Create: `yejian/src/hooks/useCurrentUser.ts`
- Create: `yejian/src/hooks/useUiPreference.ts`

- [ ] **Step 1: 写 yejian/src/config/app.ts**

```ts
/**
 * 全局应用常量。
 * 用途：集中存放跨组件共享的配置项，避免散落字面量。
 */
export const PROJECT_DIR_PREFIX = "user-"
export const WORKSPACE_PATH = "/workspace"
export const APP_TITLE = "广东冶建施工图审查中心AI工作台"
```

- [ ] **Step 2: 写 yejian/src/utils/phoneMask.ts**

```ts
/**
 * 把 11 位中国大陆手机号中间 4 位打码显示。
 * 入参：phone — 字符串形式手机号
 * 返回：打码后字符串；若格式不符则原样返回
 * 示例：maskPhone("13826001876") === "138****1876"
 */
export function maskPhone(phone: string): string {
  if (!/^1\d{10}$/.test(phone)) return phone
  return phone.slice(0, 3) + "****" + phone.slice(7)
}
```

- [ ] **Step 3: 写 yejian/src/hooks/useCurrentUser.ts**

```ts
import { createMemo } from "solid-js"

/**
 * 读取当前登录用户的手机号。
 * 用途：从 index.html 的 <meta name="x-user"> 读取 nginx 注入的手机号；
 *      开发模式下若占位符 __USER__ 未被替换，回退到环境变量 VITE_DEV_USER。
 * 入参：无
 * 返回：响应式手机号字符串（11 位）；未登录或读取失败时为 ""
 */
export function useCurrentUser() {
  return createMemo(() => {
    const meta = document.querySelector('meta[name="x-user"]') as HTMLMetaElement | null
    const raw = meta?.content ?? ""
    if (raw && raw !== "__USER__") return raw
    return (import.meta.env.VITE_DEV_USER as string | undefined) ?? ""
  })
}
```

- [ ] **Step 4: 写 yejian/src/hooks/useUiPreference.ts**

```ts
import { createSignal, createEffect } from "solid-js"

type Prefs = {
  panelTwoVisible: boolean
  reviewVisible: boolean
  terminalVisible: boolean
  panelOneWidth: number
  panelTwoWidth: number
  reviewWidth: number
}

const KEY = "yejian.ui.prefs.v1"

const DEFAULT: Prefs = {
  panelTwoVisible: true,
  reviewVisible: false,
  terminalVisible: false,
  panelOneWidth: 180,
  panelTwoWidth: 220,
  reviewWidth: 280,
}

/**
 * 持久化 UI 偏好（折叠状态 + 列宽）。
 * 用途：所有面板折叠/拖动的状态通过本 hook 读写 localStorage，下次进入恢复。
 * 入参：无
 * 返回：[读取函数, 更新函数]
 */
export function useUiPreference() {
  const initial: Prefs = (() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return DEFAULT
      return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Prefs>) }
    } catch {
      return DEFAULT
    }
  })()
  const [prefs, setPrefs] = createSignal<Prefs>(initial)
  createEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs()))
    } catch {
      // 隐私模式可能 setItem 抛错；忽略即可
    }
  })
  return [prefs, setPrefs] as const
}
```

- [ ] **Step 5: 写 yejian/src/config/skills.json（完整版）**

> 完整 JSON 较长，按设计文档 §4.4.2 与 §12 附录写入：含 7 个分组、共 49 个技能；占位技能写 `{id, name, placeholder: true}`，可用技能写完整 5 字段（id/name/invokeName/prompt/tooltip）。

对于"可用"技能（参考 §12 附录），prompt 字段需具体填写。下面给一个完整可用技能的样板：

```jsonc
{
  "id": "online-to-md",
  "name": "PDF转MD",
  "invokeName": "online-to-md",
  "prompt": "调用技能 online-to-md，请把以下 PDF 转为 Markdown：\n【请粘贴 PDF 链接或在聊天框中上传 PDF 文件】",
  "tooltip": {
    "detail": "把在线 PDF 或本地 PDF 转换为 Markdown 文档，保留章节、表格、图片描述。",
    "keywords": ["PDF", "online-to-md", "MD 转换"],
    "example": "把 https://xxx.pdf 转为 Markdown，输出到当前项目目录"
  }
}
```

执行人按 §12 附录列出的 11 个"可用"技能（PDF转MD、绿建审查、市系统下载PDF、现行规范编号、现行图集、规范图集自更新、公文排版、文本转语音、梳理思路、个人决策顾问、文章去AI味）依此模板补全 prompt 与 tooltip 三段（具体提示词由用户提供——若用户未提供，留具体的工作指令骨架并标注 `TODO 待用户审阅`）。其余 38 个占位技能仅写 `{id, name, placeholder: true}`。

完整文件按设计文档 §4.4.2 给出的分组顺序排列。

- [ ] **Step 6: typecheck**

```bash
cd D:/ai/opencode/yejian && bun typecheck
```

预期：无 error。

- [ ] **Step 7: 单元测试 phoneMask（轻量）**

```bash
mkdir -p D:/ai/opencode/yejian/src/utils
```

`yejian/src/utils/phoneMask.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { maskPhone } from "./phoneMask"

describe("maskPhone", () => {
  test("标准 11 位手机号打码", () => {
    expect(maskPhone("13826001876")).toBe("138****1876")
  })
  test("非法格式原样返回", () => {
    expect(maskPhone("123")).toBe("123")
    expect(maskPhone("")).toBe("")
    expect(maskPhone("23826001876")).toBe("23826001876") // 不以 1 开头
  })
})
```

跑：

```bash
cd D:/ai/opencode/yejian
bun test src/utils/phoneMask.test.ts
```

预期：2 passed, 0 failed。

- [ ] **Step 8: Commit**

```bash
cd D:/ai/opencode
git add yejian/src/config yejian/src/utils yejian/src/hooks
git commit -m "feat(yejian): 增加技能配置、手机号工具、当前用户与 UI 偏好 hooks"
git push origin yejian-main
```

---

## Task 5：左侧面板一 PanelOne（技能/通用会话/设置）

**目的：** 实现可手风琴折叠的技能导航；点击技能时把预设 prompt 填入 SessionComposerRegion。

**Files:**
- Create: `yejian/src/components/PanelOne.tsx`
- Create: `yejian/src/components/SkillTooltip.tsx`
- Create: `yejian/src/context/SkillPrompt.tsx`（用 SolidJS context 跨组件触发输入框填充）

- [ ] **Step 1: 写 SkillPrompt context**

```tsx
// yejian/src/context/SkillPrompt.tsx
import { createContext, createSignal, useContext, ParentProps } from "solid-js"

type SkillPromptCtx = {
  pendingPrompt: () => string | null
  setPrompt: (text: string) => void
  consume: () => void
}

const Ctx = createContext<SkillPromptCtx>()

/**
 * 跨组件 prompt 注入通道。
 * 用途：PanelOne 写入预设 prompt，SessionPage 内部消费写入 Composer 当前 textarea。
 * 入参：children
 * 返回：Provider 节点
 */
export function SkillPromptProvider(props: ParentProps) {
  const [pendingPrompt, setPendingPrompt] = createSignal<string | null>(null)
  const value: SkillPromptCtx = {
    pendingPrompt,
    setPrompt: (t) => setPendingPrompt(t),
    consume: () => setPendingPrompt(null),
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

/**
 * 消费 SkillPrompt context。
 * 入参：无
 * 返回：context 对象；未包 Provider 时抛错。
 */
export function useSkillPrompt() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSkillPrompt 必须在 <SkillPromptProvider> 内使用")
  return v
}
```

- [ ] **Step 2: 写 SkillTooltip 组件**

```tsx
// yejian/src/components/SkillTooltip.tsx
import { Show } from "solid-js"

type Props = {
  show: boolean
  x: number
  y: number
  placeholder?: boolean
  detail?: string
  keywords?: string[]
  example?: string
}

/**
 * 技能悬浮提示框。
 * 用途：鼠标 hover 技能时显示详情/关键词/案例；占位技能仅显示"功能开发中"。
 * 入参：show 是否显示；x,y 屏幕坐标；其余为内容字段
 * 返回：浮层 JSX（fixed 定位）
 */
export function SkillTooltip(p: Props) {
  return (
    <Show when={p.show}>
      <div
        style={{
          position: "fixed",
          left: `${p.x + 10}px`,
          top: `${p.y + 10}px`,
          "max-width": "320px",
          padding: "8px 12px",
          background: "#1f2937",
          color: "#e5e7eb",
          "border-radius": "6px",
          "box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
          "font-size": "12px",
          "line-height": "1.5",
          "z-index": 9999,
          "pointer-events": "none",
        }}
      >
        <Show when={p.placeholder} fallback={
          <>
            <Show when={p.detail}><div style={{ "margin-bottom": "6px" }}>{p.detail}</div></Show>
            <Show when={p.keywords?.length}>
              <div style={{ color: "#9ca3af" }}>关键词：{p.keywords!.join(", ")}</div>
            </Show>
            <Show when={p.example}>
              <div style={{ color: "#9ca3af", "margin-top": "4px" }}>例：{p.example}</div>
            </Show>
          </>
        }>
          <div>功能开发中</div>
        </Show>
      </div>
    </Show>
  )
}
```

- [ ] **Step 3: 写 PanelOne 组件**

```tsx
// yejian/src/components/PanelOne.tsx
import { For, Show, createSignal } from "solid-js"
import skillsConfig from "@yejian/config/skills.json"
import { useSkillPrompt } from "@yejian/context/SkillPrompt"
import { SkillTooltip } from "./SkillTooltip"

type Skill = {
  id: string
  name: string
  placeholder?: boolean
  invokeName?: string
  prompt?: string
  tooltip?: { detail?: string; keywords?: string[]; example?: string }
}
type Group = { id: string; name: string; skills: Skill[] }

/**
 * 左侧面板一：通用会话 / 技能会话 / 设置。
 * 用途：渲染手风琴式技能导航；点击技能时通过 SkillPromptContext 写入 prompt。
 * 入参：onOpenSettings 设置按钮回调（外部传入打开 opencode 设置面板的逻辑）
 * 返回：纵向导航 JSX
 */
export function PanelOne(props: { onOpenSettings: () => void }) {
  const groups = skillsConfig.groups as Group[]
  const { setPrompt } = useSkillPrompt()
  const [mode, setMode] = createSignal<"general" | "skill">("general")
  const [allExpanded, setAllExpanded] = createSignal(false)
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set())
  const [hover, setHover] = createSignal<{ skill: Skill; x: number; y: number } | null>(null)

  const isGroupOpen = (gid: string) => allExpanded() || expandedGroups().has(gid)

  const toggleGroup = (gid: string) => {
    const next = new Set(expandedGroups())
    if (next.has(gid)) next.delete(gid)
    else next.add(gid)
    setExpandedGroups(next)
  }

  const toggleAll = () => {
    setAllExpanded(!allExpanded())
    if (!allExpanded()) setExpandedGroups(new Set())
  }

  const onSkillClick = (s: Skill) => {
    if (s.placeholder) return
    if (s.prompt) setPrompt(s.prompt)
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", padding: "8px", gap: "4px", height: "100%" }}>
      <button
        style={navItemStyle(mode() === "general")}
        onClick={() => setMode("general")}
      >💬 通用会话</button>

      <button
        style={navItemStyle(mode() === "skill")}
        onClick={() => { setMode("skill"); toggleAll() }}
      >
        🛠 技能会话 <span style={{ float: "right" }}>{allExpanded() ? "▾" : "▸"}</span>
      </button>

      <Show when={mode() === "skill"}>
        <For each={groups}>{(g) => (
          <div>
            <button style={groupItemStyle()} onClick={() => toggleGroup(g.id)}>
              📁 {g.name} <span style={{ float: "right" }}>{isGroupOpen(g.id) ? "▾" : "▸"}</span>
            </button>
            <Show when={isGroupOpen(g.id)}>
              <For each={g.skills}>{(s) => (
                <button
                  style={skillItemStyle(s.placeholder)}
                  disabled={s.placeholder}
                  onClick={() => onSkillClick(s)}
                  onMouseEnter={(e) => setHover({ skill: s, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover({ skill: s, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                >· {s.name}{s.placeholder ? "" : ""}</button>
              )}</For>
            </Show>
          </div>
        )}</For>
      </Show>

      <div style={{ "margin-top": "auto" }}>
        <button style={navItemStyle(false)} onClick={props.onOpenSettings}>⚙ 设置</button>
      </div>

      <SkillTooltip
        show={!!hover()}
        x={hover()?.x ?? 0}
        y={hover()?.y ?? 0}
        placeholder={hover()?.skill.placeholder}
        detail={hover()?.skill.tooltip?.detail}
        keywords={hover()?.skill.tooltip?.keywords}
        example={hover()?.skill.tooltip?.example}
      />
    </div>
  )
}

const navItemStyle = (active: boolean): any => ({
  "text-align": "left", padding: "6px 8px", border: "none",
  background: active ? "#334155" : "transparent",
  color: "#e2e8f0", cursor: "pointer", "border-radius": "4px",
})
const groupItemStyle = (): any => ({
  "text-align": "left", padding: "4px 8px 4px 16px", border: "none",
  background: "transparent", color: "#cbd5e1", cursor: "pointer", "border-radius": "4px",
  width: "100%",
})
const skillItemStyle = (placeholder?: boolean): any => ({
  "text-align": "left", padding: "2px 8px 2px 28px", border: "none",
  background: "transparent",
  color: placeholder ? "#64748b" : "#e2e8f0",
  cursor: placeholder ? "not-allowed" : "pointer",
  "border-radius": "4px", width: "100%", "font-size": "12px",
})
```

- [ ] **Step 4: 验证组件能独立渲染（写最小验证页面）**

临时把 SessionPage 改成：

```tsx
import { SkillPromptProvider } from "@yejian/context/SkillPrompt"
import { PanelOne } from "@yejian/components/PanelOne"

export default function SessionPage() {
  return (
    <SkillPromptProvider>
      <div style={{ display: "flex", height: "100vh", background: "#0f172a" }}>
        <div style={{ width: "200px", background: "#1e293b" }}>
          <PanelOne onOpenSettings={() => alert("打开设置（待实现）")} />
        </div>
        <div style={{ flex: 1, color: "#e2e8f0", padding: "20px" }}>主区占位</div>
      </div>
    </SkillPromptProvider>
  )
}
```

跑 dev：

```bash
cd D:/ai/opencode/yejian && bun dev
```

访问 http://localhost:3100/yejian。验收：
- 看到「通用会话」「技能会话」「设置」三项
- 点「技能会话」展开所有分组
- 点单个分组只切换该分组，其它不变
- 占位技能（灰色）不可点
- 鼠标悬浮技能显示 Tooltip
- 鼠标悬浮占位技能 Tooltip 显示「功能开发中」

- [ ] **Step 5: Commit**

```bash
cd D:/ai/opencode
git add yejian/src/components yejian/src/context yejian/src/pages
git commit -m "feat(yejian): 实现左侧面板一（技能导航 + 悬浮提示 + prompt 注入通道）"
git push origin yejian-main
```

---

## Task 6：左侧面板二 PanelTwo（项目-Session 树）

**目的：** 按当前用户过滤项目；展开后列 session（含相对时间）。

**Files:**
- Create: `yejian/src/components/PanelTwo.tsx`
- Create: `yejian/src/hooks/useProjects.ts`
- Create: `yejian/src/hooks/useProjectSessions.ts`
- Create: `yejian/src/utils/relativeTime.ts`

- [ ] **Step 1: 写 relativeTime 工具**

```ts
// yejian/src/utils/relativeTime.ts
/**
 * 把 UNIX 毫秒时间戳格式化为中文相对时间。
 * 入参：ms — 毫秒时间戳
 * 返回："刚刚" / "X 分钟前" / "X 小时前" / "昨天" / "X 天前" / 绝对日期
 */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分钟前"
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 小时前"
  if (diff < 172_800_000) return "昨天"
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + " 天前"
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * 绝对时间字符串（用于 Tooltip 显示）。
 */
export function absoluteTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```

- [ ] **Step 2: 写 useProjects hook**

```ts
// yejian/src/hooks/useProjects.ts
import { createResource } from "solid-js"
import { useSDK } from "@opencode-ai/app"  // 真实 import 路径需先 grep 验证
import { PROJECT_DIR_PREFIX, WORKSPACE_PATH } from "@yejian/config/app"
import { useCurrentUser } from "./useCurrentUser"

/**
 * 当前用户的项目列表。
 * 用途：调 SDK 列出 /workspace 下目录，按前缀过滤，再按当前用户隔离
 *      （UI 层过滤；后端隔离不在本期范围）。
 * 入参：无
 * 返回：[resource, refetch]
 */
export function useProjects() {
  const user = useCurrentUser()
  return createResource(user, async (phone) => {
    if (!phone) return []
    const sdk = useSDK()
    // 注：SDK 列目录的真实 API 需先 grep packages/app 用法
    const all: { name: string; path: string }[] = await listDir(sdk, WORKSPACE_PATH)
    return all
      .filter((d) => d.name.startsWith(PROJECT_DIR_PREFIX))
      .filter((d) => d.name === PROJECT_DIR_PREFIX + phone)
      .map((d) => ({ name: d.name.slice(PROJECT_DIR_PREFIX.length), path: d.path }))
  })
}

/**
 * 调用 SDK 列出某目录的子目录。
 * 入参：sdk, dir 绝对路径
 * 返回：name + path 列表
 * 注：API 名称需对照 packages/app 实际用法替换（如 sdk.directory.list / sdk.client.file.list）。
 */
async function listDir(sdk: any, dir: string): Promise<{ name: string; path: string }[]> {
  // TODO 实施前请 grep packages/app/src 找 sdk.directory 或 sdk.client.file 真实调用
  throw new Error("listDir 未对接真实 SDK API；请先在 packages/app/src 搜索 directory 用法")
}
```

> **重要**：本步骤含 1 处 TODO，是因为 SDK 的列目录 API 名称需要实施期先在 packages/app/src 搜索现有用法（例如：`grep -rn "directory" packages/app/src/context`）确认。实施这一步时**先做 SDK 探索，再写代码**。

- [ ] **Step 3: 探索 SDK 列目录 API（前置探索步骤）**

```bash
cd D:/ai/opencode
grep -rn "directory\." packages/app/src --include="*.tsx" --include="*.ts" | head -20
grep -rn "useSDK\|sdk\.client" packages/app/src/context/sdk.tsx | head -10
```

预期：找到 `sdk.directory.list(path)` 或 `sdk.client.directory.list({ path })` 之类调用。把 useProjects 里的 TODO 填上真实调用。

- [ ] **Step 4: 写 useProjectSessions hook**

```ts
// yejian/src/hooks/useProjectSessions.ts
import { createResource, Accessor } from "solid-js"
import { useSync } from "@opencode-ai/app"  // 真实路径同上需先 grep 验证

/**
 * 某项目目录下的 session 列表。
 * 入参：dir 项目绝对路径 Accessor
 * 返回：[resource, refetch]
 */
export function useProjectSessions(dir: Accessor<string | undefined>) {
  return createResource(dir, async (d) => {
    if (!d) return []
    const sync = useSync()
    // TODO 实施前 grep sync.session.list / sync.session.sync 真实签名
    throw new Error("useProjectSessions 待对接真实 sync API")
  })
}
```

同样含 TODO，实施期先探索：

```bash
grep -rn "session\.list\|session\.sync" packages/app/src/context | head -10
```

- [ ] **Step 5: 写 PanelTwo 组件**

```tsx
// yejian/src/components/PanelTwo.tsx
import { For, Show, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useCurrentUser } from "@yejian/hooks/useCurrentUser"
import { useProjects } from "@yejian/hooks/useProjects"
import { useProjectSessions } from "@yejian/hooks/useProjectSessions"
import { maskPhone } from "@yejian/utils/phoneMask"
import { relativeTime, absoluteTime } from "@yejian/utils/relativeTime"

/**
 * 左侧面板二：项目-Session 树。
 * 用途：列出当前用户项目；展开后显示项目内 sessions（按 updatedAt desc）。
 * 入参：onCollapse 折叠面板回调
 * 返回：纵向树 JSX
 */
export function PanelTwo(props: { onCollapse: () => void }) {
  const user = useCurrentUser()
  const [projects, { refetch: refetchProjects }] = useProjects()
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const navigate = useNavigate()

  const refreshAll = () => {
    refetchProjects()
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", padding: "8px" }}>
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
        <div style={{ color: "#60a5fa", "font-weight": "bold" }}>项目列表</div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button title="刷新" onClick={refreshAll} style={iconBtnStyle()}>⟳</button>
          <button title="折叠面板" onClick={props.onCollapse} style={iconBtnStyle()}>◀</button>
        </div>
      </div>

      <Show when={!user()}>
        <div style={{ color: "#94a3b8", "font-size": "12px" }}>未登录</div>
      </Show>

      <For each={projects() ?? []}>{(p) => (
        <ProjectItem
          phone={p.name}
          dir={p.path}
          expanded={expanded().has(p.path)}
          onToggle={() => {
            const next = new Set(expanded())
            if (next.has(p.path)) next.delete(p.path)
            else next.add(p.path)
            setExpanded(next)
          }}
          onOpenSession={(id) => navigate(`/yejian/${btoa(p.path)}/session/${id}`)}
          onNewSession={async () => {
            // TODO 实施期对接 sdk.client.session.create({ directory: p.path })
            alert("新建会话待对接 SDK")
          }}
        />
      )}</For>

      <Show when={projects() && projects()!.length === 0 && user()}>
        <div style={{ color: "#94a3b8", "font-size": "12px", padding: "8px" }}>
          未找到您的项目目录，请联系管理员
        </div>
      </Show>
    </div>
  )
}

function ProjectItem(props: {
  phone: string
  dir: string
  expanded: boolean
  onToggle: () => void
  onOpenSession: (id: string) => void
  onNewSession: () => void
}) {
  const [sessions] = useProjectSessions(() => (props.expanded ? props.dir : undefined))
  return (
    <div>
      <button
        title={props.phone}
        onClick={props.onToggle}
        style={{ "text-align": "left", padding: "4px 8px", border: "none", background: "transparent", color: "#e2e8f0", cursor: "pointer", width: "100%" }}
      >
        📁 {maskPhone(props.phone)} <span style={{ float: "right" }}>{props.expanded ? "▾" : "▸"}</span>
      </button>
      <Show when={props.expanded}>
        <For each={sessions() ?? []}>{(s: any) => (
          <button
            onClick={() => props.onOpenSession(s.id)}
            style={{ "text-align": "left", padding: "2px 8px 2px 24px", border: "none", background: "transparent", color: "#cbd5e1", cursor: "pointer", width: "100%", "font-size": "12px" }}
          >
            💬 {s.title ?? "(未命名)"}<br />
            <span title={absoluteTime(s.updatedAt)} style={{ color: "#94a3b8", "font-size": "10px" }}>
              {relativeTime(s.updatedAt)}
            </span>
          </button>
        )}</For>
        <button
          onClick={props.onNewSession}
          style={{ "text-align": "left", padding: "4px 8px 4px 24px", border: "none", background: "transparent", color: "#60a5fa", cursor: "pointer", width: "100%", "font-size": "12px" }}
        >+ 新建会话</button>
      </Show>
    </div>
  )
}

const iconBtnStyle = (): any => ({
  background: "#475569", border: "none", color: "#e2e8f0", "border-radius": "3px",
  padding: "2px 8px", cursor: "pointer", "font-size": "12px",
})
```

- [ ] **Step 6: 在 SessionPage 加 PanelTwo 验证**

修改 SessionPage 临时加上 PanelTwo（前提：dev 环境 `.env.local` 配置 `VITE_DEV_USER=13826001876`，并在工作区目录里建 `user-13826001876/`，再启动 opencode-server 指向该 workspace）：

```bash
echo VITE_DEV_USER=13826001876 > D:/ai/opencode/yejian/.env.local
mkdir D:/AI/AIworkbench/user-13826001876
```

跑 dev 访问 http://localhost:3100/yejian，验收：
- 面板二显示 `📁 138****1876`，悬浮显示完整号码
- 点击展开能看到 session（如果该目录里有 session）
- 看不到别的 `user-*` 目录（即使工作区里存在）

- [ ] **Step 7: Commit**

```bash
cd D:/ai/opencode
git add yejian/src/components/PanelTwo.tsx yejian/src/hooks yejian/src/utils/relativeTime.ts yejian/.env.local
git commit -m "feat(yejian): 实现左侧面板二（项目-Session 树，按当前用户过滤）"
git push origin yejian-main
```

> 注：`.env.local` 已被根 `.gitignore` 的 `.env.local` 规则忽略；如果没被忽略需在 yejian 内补 `.gitignore`。

---

## Task 7：组装 SessionPage（四列布局 + 复用 region + ErrorBoundary）

**目的：** 把面板一、面板二、官方 region 拼成完整工作台；接入 SkillPrompt 注入逻辑。

**Files:**
- Modify: `yejian/src/pages/SessionPage.tsx`
- Create: `yejian/src/components/ErrorBoundary.tsx`

- [ ] **Step 1: 写中文化 ErrorBoundary**

```tsx
// yejian/src/components/ErrorBoundary.tsx
import { ErrorBoundary as SolidErrorBoundary, ParentProps } from "solid-js"

/**
 * 中文化错误边界。
 * 用途：兜底捕获子组件运行时错误，显示中文友好提示与"复制错误"按钮。
 * 入参：children
 * 返回：错误 fallback 或正常 children
 */
export function ErrorBoundary(props: ParentProps) {
  return (
    <SolidErrorBoundary
      fallback={(err: Error, reset: () => void) => (
        <div style={{ padding: "20px", color: "#e2e8f0", "font-family": "system-ui" }}>
          <h2>⚠️ 出现了一个问题</h2>
          <p>请尝试刷新页面。如果问题持续，请把以下错误详情发给管理员：</p>
          <pre style={{ background: "#1e293b", padding: "12px", "border-radius": "4px", "overflow": "auto", "max-height": "200px" }}>
            {err.message}
            {"\n\n"}
            {err.stack}
          </pre>
          <div style={{ "margin-top": "12px", display: "flex", gap: "8px" }}>
            <button
              onClick={() => navigator.clipboard.writeText(`${err.message}\n\n${err.stack ?? ""}`).then(() => alert("已复制到剪贴板"))}
              style={btnStyle()}
            >复制错误详情</button>
            <button onClick={() => location.reload()} style={btnStyle()}>刷新页面</button>
            <button onClick={reset} style={btnStyle()}>重试</button>
          </div>
        </div>
      )}
    >{props.children}</SolidErrorBoundary>
  )
}

const btnStyle = (): any => ({
  padding: "6px 12px", background: "#3b82f6", color: "white",
  border: "none", "border-radius": "4px", cursor: "pointer",
})
```

- [ ] **Step 2: 改写 SessionPage（完整版）**

```tsx
// yejian/src/pages/SessionPage.tsx
import { Show, createEffect, onMount } from "solid-js"
import { useParams } from "@solidjs/router"
import {
  MessageTimeline,
  SessionComposerRegion,
  createSessionComposerState,
  SessionReviewTab,
  TerminalPanel,
} from "@opencode-ai/app"
import { PanelOne } from "@yejian/components/PanelOne"
import { PanelTwo } from "@yejian/components/PanelTwo"
import { ErrorBoundary } from "@yejian/components/ErrorBoundary"
import { SkillPromptProvider, useSkillPrompt } from "@yejian/context/SkillPrompt"
import { useUiPreference } from "@yejian/hooks/useUiPreference"

/**
 * Session 页面主组件。
 * 用途：四列布局（面板一 + 面板二 + 主区 + 右侧审查）+ 底部终端。
 * 入参：路由 :dir / :id（base64 dir, sessionId）
 * 返回：完整工作台 JSX
 */
export default function SessionPage() {
  return (
    <SkillPromptProvider>
      <ErrorBoundary>
        <SessionPageInner />
      </ErrorBoundary>
    </SkillPromptProvider>
  )
}

function SessionPageInner() {
  const params = useParams()
  const [prefs, setPrefs] = useUiPreference()
  const composer = createSessionComposerState()
  const { pendingPrompt, consume } = useSkillPrompt()

  // 将 PanelOne 注入的 prompt 写入 composer textarea
  createEffect(() => {
    const t = pendingPrompt()
    if (!t) return
    composer.setValue(t)  // 注：setValue 的真实方法名需对照 createSessionComposerState 实现
    consume()
    // 光标定位第一个【...】占位
    queueMicrotask(() => {
      const m = t.match(/【[^】]+】/)
      if (m && composer.textareaRef?.()) {
        const el = composer.textareaRef()!
        el.focus()
        el.setSelectionRange(m.index!, m.index!)
      }
    })
  })

  return (
    <div style={{ display: "grid", "grid-template-rows": "1fr auto", height: "100vh", background: "#0f172a" }}>
      <div style={{
        display: "grid",
        "grid-template-columns": `${prefs().panelOneWidth}px ${prefs().panelTwoVisible ? prefs().panelTwoWidth + "px" : "0"} 1fr ${prefs().reviewVisible ? prefs().reviewWidth + "px" : "0"}`,
        overflow: "hidden",
      }}>
        <aside style={{ background: "#1e293b", "border-right": "1px solid #334155", overflow: "auto" }}>
          <PanelOne onOpenSettings={() => alert("打开设置：实施期对接 opencode 设置面板触发逻辑")} />
        </aside>

        <Show when={prefs().panelTwoVisible}>
          <aside style={{ background: "#1e293b", "border-right": "1px solid #334155", overflow: "auto" }}>
            <PanelTwo onCollapse={() => setPrefs({ ...prefs(), panelTwoVisible: false })} />
          </aside>
        </Show>

        <main style={{ display: "grid", "grid-template-rows": "1fr auto", overflow: "hidden" }}>
          <div style={{ overflow: "auto" }}>
            <Show when={params.id} fallback={<EmptyState onShowPanelTwo={() => setPrefs({ ...prefs(), panelTwoVisible: true })} />}>
              <MessageTimeline sessionId={params.id!} />
            </Show>
          </div>
          <SessionComposerRegion state={composer} />
        </main>

        <Show when={prefs().reviewVisible}>
          <aside style={{ background: "#1e293b", "border-left": "1px solid #334155", overflow: "auto" }}>
            <SessionReviewTab />
          </aside>
        </Show>
      </div>

      <Show when={prefs().terminalVisible}>
        <div style={{ height: "30vh", "border-top": "1px solid #334155" }}>
          <TerminalPanel />
        </div>
      </Show>
    </div>
  )
}

function EmptyState(props: { onShowPanelTwo: () => void }) {
  return (
    <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "100%", color: "#94a3b8" }}>
      <div style={{ "text-align": "center" }}>
        <p>请从左侧选择会话或新建会话</p>
        <button onClick={props.onShowPanelTwo} style={{ padding: "8px 16px", background: "#3b82f6", color: "white", border: "none", "border-radius": "4px", cursor: "pointer" }}>
          打开项目列表
        </button>
      </div>
    </div>
  )
}
```

> **隐藏前置**：`createSessionComposerState` 的真实 API（setValue / textareaRef）以及 `MessageTimeline`、`SessionComposerRegion`、`SessionReviewTab`、`TerminalPanel` 的 props 签名，需先 Read 对应文件确认。如果 setValue 不存在，可能需要通过 composer 内部的 signal setter 设置。实施期**第一步是补全这些 API 对接**。

- [ ] **Step 3: 在 dev 环境完整验证**

```bash
cd D:/ai/opencode/yejian && bun dev
```

访问 http://localhost:3100/yejian。验收清单：
- 网页 title = 「广东冶建施工图审查中心AI工作台」
- 四列布局正常显示
- 面板二只显示当前用户项目
- 点击技能后输入框被覆盖为 prompt
- 占位技能不可点
- 折叠面板二/右侧/底部状态刷新页面后保留
- 文件树看不到 `.opencode/`、`.git/` 等

- [ ] **Step 4: typecheck**

```bash
cd D:/ai/opencode/yejian && bun typecheck
```

预期：无 error。

- [ ] **Step 5: Commit**

```bash
cd D:/ai/opencode
git add yejian/src
git commit -m "feat(yejian): 组装 SessionPage 四列布局并接入 ErrorBoundary"
git push origin yejian-main
```

---

## Task 8：构建 yejian 静态产物 + opencode-server Dockerfile

**目的：** 准备 docker 构建的两个原料。

**Files:**
- Create: `docker/.env.example`
- Create: `docker/opencode-server/Dockerfile`

- [ ] **Step 1: 创建 docker 目录**

```bash
cd D:/ai/opencode
mkdir -p docker/{nginx,opencode-server,scripts}
```

- [ ] **Step 2: 写 docker/.env.example**

```bash
# yejian web 工作台环境配置（复制为 .env 后填实际值）

# 工作区目录（用户项目 + 公共资源所在地）
WORKSPACE_PATH=D:/AI/AIworkbench

# 容器持久化数据
DATA_PATH=D:/AI/AIworkbench-data

# opencode CLI 固定版本
OPENCODE_VERSION=1.16.2

# 对外端口
WEB_PORT=8088
```

- [ ] **Step 3: 写 docker/opencode-server/Dockerfile**

```dockerfile
FROM oven/bun:1.3-alpine
ARG OPENCODE_VERSION=1.16.2
RUN bun add -g opencode-ai@${OPENCODE_VERSION}
WORKDIR /workspace
EXPOSE 4096
ENTRYPOINT ["opencode", "serve", "--port", "4096", "--hostname", "0.0.0.0"]
```

- [ ] **Step 4: 测试构建 opencode-server 镜像**

```bash
cd D:/ai/opencode/docker/opencode-server
docker build --build-arg OPENCODE_VERSION=1.16.2 -t yejian-opencode-test:1.16.2 .
```

预期：构建成功，最后输出 `Successfully tagged yejian-opencode-test:1.16.2`。

- [ ] **Step 5: 测试运行容器**

```bash
docker run --rm -p 4096:4096 -v D:/AI/AIworkbench:/workspace yejian-opencode-test:1.16.2
```

另一个终端：

```bash
curl http://localhost:4096/api/status   # 或任意 opencode 暴露的端点
```

预期：返回 200 或 opencode 默认响应。`Ctrl+C` 停止容器。

- [ ] **Step 6: Commit**

```bash
cd D:/ai/opencode
git add docker/.env.example docker/opencode-server
git commit -m "feat(docker): opencode-server 容器构建文件（基于 oven/bun:1.3-alpine）"
git push origin yejian-main
```

---

## Task 9：nginx 容器（basic auth + 反代 + X-User 注入）

**Files:**
- Create: `docker/nginx/Dockerfile`
- Create: `docker/nginx/nginx.conf`
- Create: `docker/nginx/htpasswd.example`

- [ ] **Step 1: 写 docker/nginx/Dockerfile**

```dockerfile
FROM nginx:alpine
RUN apk add --no-cache apache2-utils
# nginx.conf 与 htpasswd 通过 volume 挂载，镜像内不预置
```

- [ ] **Step 2: 写 docker/nginx/nginx.conf**

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  client_max_body_size 100M;

  upstream opencode_backend {
    server opencode-server:4096;
  }

  server {
    listen 80;
    server_name _;
    charset utf-8;

    error_page 502 503 504 /50x.html;
    location = /50x.html {
      default_type text/html;
      return 502 '<html><body style="font-family:sans-serif;text-align:center;padding-top:50px"><h1>后端服务暂时不可用</h1><p>请联系管理员或稍后重试。</p></body></html>';
    }

    auth_basic "广东冶建施工图审查中心 AI 工作台";
    auth_basic_user_file /etc/nginx/htpasswd;

    location ~ ^/(api|event|pty|ws)/ {
      proxy_pass http://opencode_backend;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header X-User $remote_user;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 86400s;
    }

    location / {
      root /usr/share/nginx/html;
      try_files $uri /index.html;
      sub_filter '<meta name="x-user" content="__USER__">' '<meta name="x-user" content="$remote_user">';
      sub_filter_once on;
      sub_filter_types text/html;
    }
  }
}
```

- [ ] **Step 3: 写 docker/nginx/htpasswd.example**

```
# 此文件仅作模板，实际请用 docker/scripts/add-user.bat 生成 htpasswd（bcrypt 加密）。
# 真实 htpasswd 文件不要提交到 git。
```

并在 `docker/nginx/.gitignore` 加：

```
htpasswd
```

- [ ] **Step 4: Commit**

```bash
cd D:/ai/opencode
git add docker/nginx/
git commit -m "feat(docker): nginx 容器（basic auth + 反代 + X-User 注入）"
git push origin yejian-main
```

---

## Task 10：docker-compose.yml + 构建 web

**Files:**
- Create: `docker/docker-compose.yml`

- [ ] **Step 1: 写 docker/docker-compose.yml**

```yaml
services:
  opencode-server:
    build:
      context: ./opencode-server
      args:
        OPENCODE_VERSION: ${OPENCODE_VERSION}
    container_name: yejian-opencode
    restart: unless-stopped
    volumes:
      - ${WORKSPACE_PATH}:/workspace
      - ${DATA_PATH}/root:/root
      - ${DATA_PATH}/tmp:/tmp
    expose:
      - "4096"
    networks:
      - internal

  nginx:
    build: ./nginx
    container_name: yejian-nginx
    restart: unless-stopped
    ports:
      - "${WEB_PORT}:80"
    volumes:
      - ../yejian/dist:/usr/share/nginx/html:ro
      - ./nginx/htpasswd:/etc/nginx/htpasswd:ro
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - opencode-server
    networks:
      - internal

networks:
  internal:
    driver: bridge
```

- [ ] **Step 2: 构建 yejian web 静态产物**

```bash
cd D:/ai/opencode/yejian
bun run build
ls dist
```

预期：`dist/` 下有 `index.html`、`assets/*.js`、`assets/*.css` 等。`index.html` 含 `<meta name="x-user" content="__USER__" />`（nginx 会替换 `__USER__`）。

- [ ] **Step 3: 准备 .env、htpasswd、宿主目录**

```bash
cd D:/ai/opencode/docker
cp .env.example .env
# 编辑 .env，确认 WORKSPACE_PATH 等正确

# 创建宿主目录
mkdir D:/AI/AIworkbench
mkdir -p D:/AI/AIworkbench-data/root D:/AI/AIworkbench-data/tmp
mkdir D:/AI/AIworkbench/user-13826001876

# 用 docker 临时容器跑 htpasswd 生成账号
docker run --rm -it -v ${PWD}/nginx:/etc/nginx httpd:alpine \
  htpasswd -Bc /etc/nginx/htpasswd 13826001876
# 提示输入密码两次
```

- [ ] **Step 4: 启动 compose**

```bash
cd D:/ai/opencode/docker
docker compose up -d
docker compose ps
```

预期：两个容器都 Running。

- [ ] **Step 5: 浏览器访问验收**

打开 http://localhost:8088
- 弹出登录框，输入 `13826001876` + 你刚设的密码
- 看到「广东冶建施工图审查中心AI工作台」
- 面板二显示 `📁 138****1876`

- [ ] **Step 6: 看日志确认无错**

```bash
cd D:/ai/opencode/docker
docker compose logs --tail=50
```

预期：opencode-server 输出 `Listening on 0.0.0.0:4096` 之类；nginx 无 5xx 错误日志。

- [ ] **Step 7: Commit**

```bash
cd D:/ai/opencode
git add docker/docker-compose.yml
git commit -m "feat(docker): docker-compose 编排 nginx + opencode-server"
git push origin yejian-main
```

---

## Task 11：一键脚本（healthcheck / add-user / rebuild-web）

**Files:**
- Create: `docker/scripts/healthcheck.bat`
- Create: `docker/scripts/healthcheck.sh`
- Create: `docker/scripts/add-user.bat`
- Create: `docker/scripts/add-user.sh`
- Create: `docker/scripts/rebuild-web.bat`
- Create: `docker/scripts/rebuild-web.sh`

- [ ] **Step 1: 写 docker/scripts/healthcheck.bat**

```bat
@echo off
chcp 65001 >nul
echo === AI 工作台健康检查 ===
echo.
cd /d %~dp0\..
echo [1/5] 容器状态：
docker compose ps
echo.
echo [2/5] opencode-server 最近日志：
docker compose logs --tail=30 opencode-server
echo.
echo [3/5] nginx 最近日志：
docker compose logs --tail=30 nginx
echo.
echo [4/5] 检查工作区目录：
if defined WORKSPACE_PATH (dir "%WORKSPACE_PATH%") else (echo WORKSPACE_PATH 未设置，从 .env 读)
echo.
echo [5/5] 检查 opencode 数据目录：
if defined DATA_PATH (dir "%DATA_PATH%\root\.opencode\logs" 2>nul) else (echo DATA_PATH 未设置)
echo.
echo === 检查完成 ===
pause
```

- [ ] **Step 2: 写 docker/scripts/add-user.bat**

```bat
@echo off
chcp 65001 >nul
set /p PHONE=请输入同事的 11 位手机号：

echo %PHONE%| findstr /R "^1[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$" >nul
if errorlevel 1 (
    echo 错误：手机号格式不对，必须是 11 位、以 1 开头。
    pause
    exit /b 1
)

cd /d %~dp0\..
echo 即将为账号 %PHONE% 设置密码（提示后请输入两次密码）...
docker run --rm -it -v %CD%\nginx:/etc/nginx httpd:alpine htpasswd -B /etc/nginx/htpasswd %PHONE%
if errorlevel 1 (
    echo 密码设置失败。
    pause
    exit /b 1
)

if not exist "%WORKSPACE_PATH%\user-%PHONE%" mkdir "%WORKSPACE_PATH%\user-%PHONE%"
echo.
echo ✓ 完成：账号 %PHONE% 已添加，项目目录 %WORKSPACE_PATH%\user-%PHONE% 已创建。
echo ✓ 同事可访问 http://你的服务器IP:%WEB_PORT% 用此手机号登录。
pause
```

- [ ] **Step 3: 写 docker/scripts/rebuild-web.bat**

```bat
@echo off
chcp 65001 >nul
echo === 重新构建 yejian web ===
cd /d %~dp0\..\..\yejian
call bun install
call bun run build
if errorlevel 1 (
    echo 构建失败。
    pause
    exit /b 1
)
echo ✓ 构建完成。nginx 自动 serve 新文件，无需重启容器。
pause
```

- [ ] **Step 4: 写 Linux 等价脚本（healthcheck.sh / add-user.sh / rebuild-web.sh）**

`docker/scripts/healthcheck.sh`：

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "=== AI 工作台健康检查 ==="
echo "[1/5] 容器状态："
docker compose ps
echo "[2/5] opencode-server 最近日志："
docker compose logs --tail=30 opencode-server
echo "[3/5] nginx 最近日志："
docker compose logs --tail=30 nginx
echo "[4/5] 检查工作区目录："
ls "${WORKSPACE_PATH:-/workspace}"
echo "[5/5] 检查 opencode 数据目录："
ls "${DATA_PATH:-/data}/root/.opencode/logs" 2>/dev/null || echo "(无日志或目录不存在)"
echo "=== 检查完成 ==="
```

`docker/scripts/add-user.sh`：

```bash
#!/bin/bash
set -e
read -p "请输入同事的 11 位手机号: " PHONE
if [[ ! "$PHONE" =~ ^1[0-9]{10}$ ]]; then
  echo "错误：手机号格式不对"
  exit 1
fi
cd "$(dirname "$0")/.."
docker run --rm -it -v "$PWD/nginx:/etc/nginx" httpd:alpine htpasswd -B /etc/nginx/htpasswd "$PHONE"
mkdir -p "${WORKSPACE_PATH}/user-${PHONE}"
echo "✓ 完成：账号 $PHONE 已添加。"
```

`docker/scripts/rebuild-web.sh`：

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/../../yejian"
bun install
bun run build
echo "✓ 构建完成。"
```

加可执行权限（在 Linux 上）：

```bash
chmod +x docker/scripts/*.sh
```

- [ ] **Step 5: 端到端测试一键脚本**

```bash
cd D:/ai/opencode
docker/scripts/healthcheck.bat
```

预期：5 段输出完整。

```bash
docker/scripts/add-user.bat
# 输入 13900000002 + 设密码
# 验证 D:/AI/AIworkbench/user-13900000002 被创建
```

- [ ] **Step 6: Commit**

```bash
git add docker/scripts
git commit -m "feat(docker): 增加 healthcheck / add-user / rebuild-web 一键脚本"
git push origin yejian-main
```

---

## Task 12：端到端联调与文档收尾

**目的：** 在容器化环境完整跑一遍用户路径；写 README 引导。

**Files:**
- Create: `docker/README.md`
- Update: 根 `README.md`（可选：加一段指向 yejian + docker）

- [ ] **Step 1: 写 docker/README.md**

```markdown
# 广东冶建 AI 工作台 — 部署运维

## 首次部署（一次性）

1. **拉代码**：`git clone https://github.com/PangDingPing/opencode.git && cd opencode && git checkout yejian-main`
2. **装依赖、构建 web**：`cd yejian && bun install && bun run build`
3. **配置 .env**：`cd ../docker && cp .env.example .env`（编辑路径）
4. **建宿主目录**：`mkdir D:/AI/AIworkbench && mkdir -p D:/AI/AIworkbench-data/{root,tmp}`
5. **加管理员账号**：`scripts/add-user.bat`（输入手机号 + 密码）
6. **启动**：`docker compose up -d`
7. **访问**：`http://localhost:8088`

## 日常维护

| 任务 | 命令 |
|---|---|
| 加同事 | `scripts/add-user.bat` |
| 改了 yejian/ 代码 | `scripts/rebuild-web.bat` |
| 健康检查 | `scripts/healthcheck.bat` |
| 看日志 | `docker compose logs -f` |
| 重启 | `docker compose restart` |
| 升级 opencode | 改 `.env` 的 `OPENCODE_VERSION`，然后 `docker compose build --no-cache opencode-server && docker compose up -d opencode-server` |

## 跟随 opencode 上游

```bash
git checkout yejian-main
git fetch upstream
git log yejian-main..upstream/dev --oneline   # 看上游有什么新东西
git merge upstream/dev
# 如有冲突（多在 file-tree.tsx 或 index.ts），用 VS Code 合并解决
git push origin yejian-main
```

## 故障排查

- **打不开页面 / 502**：`scripts/healthcheck.bat` 看容器；常见为 opencode-server 挂了，`docker compose restart opencode-server`
- **登录后空白**：浏览器 F12 看 console 报错；复制错误发管理员
- **同事看不到自己的项目**：确认 `WORKSPACE_PATH/user-<手机号>` 目录存在
```

- [ ] **Step 2: 端到端用户路径验收**

按 docker/README.md 首次部署 1-7 步完整走一遍（即便已有部分操作做过，验证 README 不漏步）。

验收清单：
- [ ] http://localhost:8088 → 弹出登录框
- [ ] 输入手机号 + 密码登录成功
- [ ] 看到「广东冶建施工图审查中心AI工作台」title
- [ ] 面板一显示所有技能组（含占位技能灰色）
- [ ] 鼠标悬浮技能看到 Tooltip
- [ ] 点击「PDF转MD」→ 输入框被填入 prompt
- [ ] 面板二显示当前用户项目（打码手机号）
- [ ] 看不到别的 `user-*` 项目
- [ ] 点击 + 新建会话 → 跳到新 session 页面
- [ ] 文件树看不到 `.opencode/`、`.git/`
- [ ] 折叠右侧/底部 → 刷新页面后折叠状态保持
- [ ] 浏览器 devtools 检查 `<title>` = 「广东冶建施工图审查中心AI工作台」

- [ ] **Step 3: 跑一遍上游同步演练**

```bash
cd D:/ai/opencode
git fetch upstream
git log yejian-main..upstream/dev --oneline | head
# 如果上游有新提交，做一次 merge 演练
git merge upstream/dev --no-commit --no-ff
# 看 file-tree.tsx / index.ts 是否冲突
git status
git merge --abort   # 演练完撤销，等真升级再做
```

- [ ] **Step 4: 验证原版 packages/app 仍能独立跑（不被定制污染）**

```bash
cd D:/ai/opencode/packages/app
bun dev
```

打开 http://localhost:3000 看原版界面。`Ctrl+C` 退出。

- [ ] **Step 5: Commit & 收尾**

```bash
cd D:/ai/opencode
git add docker/README.md
git commit -m "docs(docker): 增加部署运维 README"
git push origin yejian-main
```

---

## 收尾自查

完成所有 Task 后，对照设计文档 §9 验收标准逐项打勾。任何未达成项回到对应 Task 修补。

最后状态应为：
- `yejian-main` 分支累计 ~12 个提交
- packages/* 仅 2 个文件被改（共 ~7 行）
- yejian/ + docker/ 是新增目录
- `docker compose up -d` 一条命令拉起完整可用工作台
- `git fetch upstream && git merge upstream/dev` 可无忧重复执行

---

**文档结束**
