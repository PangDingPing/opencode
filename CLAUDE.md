# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

opencode 是一个开源 AI 编程助手，提供 CLI / TUI / Web / Desktop 多种形态。仓库是 **Bun + Turborepo monorepo**（Bun 1.3+ 必备），TypeScript 为主，前端用 SolidJS，桌面端用 Electron。

- 默认分支是 **`dev`**（不是 `main`）。本地可能没有 `main` 引用——做 diff / PR 时使用 `dev` 或 `origin/dev`。
- 包管理器锁定 `bun@1.3.14`（见 `package.json` 的 `packageManager`），不要用 npm / pnpm / yarn 装依赖。
- Lint 用 **oxlint**（非 ESLint），格式化用 Prettier（`semi: false`, `printWidth: 120`）。

## Commands

所有命令在仓库根目录执行，除非另有说明。

### 安装与启动

```bash
bun install          # 装依赖（会触发 packages/core 的 postinstall: fix-node-pty）
bun dev              # 在 packages/opencode 目录下启动 TUI（开发主入口）
bun dev <directory>  # 在指定目录跑 opencode
bun dev .            # 在仓库根目录跑 opencode 自身
bun dev serve        # 启动 headless API 服务器（默认端口 4096）
bun dev serve --port 8080
bun dev web          # 同时启动服务器和 web 界面
bun dev:web          # 仅启动 packages/app 的 web 开发服务（5173 端口）
bun dev:desktop      # 启动 Electron 桌面端
bun dev:console      # 启动 packages/console/app（会先调高 ulimit）
```

> 注意：`bun dev` 默认运行的是 TUI（交互式终端界面）。如果需要在自动化或脚本中观察输出，不要直接前台跑，**用 tmux**：
> ```bash
> tmux new-session -d -s opencode-dev 'bun dev'
> tmux capture-pane -pt opencode-dev    # 抓取当前 TUI 内容
> tmux kill-session -t opencode-dev     # 用完关掉
> ```

### 类型检查、Lint、构建

```bash
bun typecheck                                       # 通过 turbo 跑整个仓库的 typecheck
bun lint                                            # oxlint
bun run --cwd packages/opencode typecheck           # 单包 typecheck
./packages/opencode/script/build.ts --single        # 构建单可执行文件
./packages/opencode/dist/opencode-<platform>/bin/opencode   # 跑构建产物
```

**不要直接调 `tsc`**——一律走 `bun typecheck`（在包目录内执行）。

### 测试

```bash
bun test    # 在根目录跑会直接报错"do not run tests from root"——这是有意的护栏
```

测试必须在 **包目录** 内运行，例如：

```bash
cd packages/opencode && bun test
cd packages/opencode && bun test path/to/file.test.ts        # 单文件
cd packages/opencode && bun test --test-name-pattern "xxx"   # 按用例名过滤
```

### SDK / API 改动后的代码生成

如果改了 API 或 SDK（例如 `packages/opencode/src/server/server.ts`），运行：

```bash
./script/generate.ts                  # 重新生成 SDK 及衍生文件
./packages/sdk/js/script/build.ts     # 重新生成 JavaScript SDK
```

### Git / 提交 / PR

- 提交信息和 PR 标题用 **conventional commits**：`type(scope): summary`
- 允许的 type：`feat` `fix` `docs` `chore` `refactor` `test`
- 常见 scope：`core` `opencode` `tui` `app` `desktop` `sdk` `plugin`
- 例：`fix(tui): simplify thinking toggle styling`
- 所有 PR **必须**关联 issue（`Fixes #123` / `Closes #123`），没有关联 issue 的 PR 可能被直接关闭。

## High-level architecture

### Monorepo 布局（`packages/*`）

核心、值得"读多个文件才能拼出全貌"的包：

- **`packages/opencode`** — opencode 的核心运行时与服务器。
  - `src/cli/cmd/tui/` — TUI 实现（SolidJS + [opentui](https://github.com/sst/opentui)，**不是 React**）
  - `src/server/` — HTTP API 服务器（Hono + hono-openapi）
  - `src/session/`, `src/agent/`, `src/tool/`, `src/skill/` — 会话、智能体、工具、技能调度
  - `src/provider/`, `src/llm/` 入口 — LLM provider 接入
  - `src/acp/` — Agent Client Protocol（编辑器/IDE 集成协议）
  - `src/effect/` — Effect 运行时基础设施（`makeRuntime`、`InstanceState` 等，见下方"Effect 约定"）
  - `src/project/`, `src/worktree/` — 项目/工作区管理
  - `src/lsp/`, `src/mcp/` — LSP 客户端与 MCP（Model Context Protocol）集成
  - `src/skill/prompt/customize-opencode.md` — opencode 自定义提示模板
  - `specs/effect/` — Effect 迁移指南、规范（**写/改 Effect 代码前必读**）
- **`packages/core`** — 跨包共享的核心库；**Drizzle 数据库 schema** 在这里（`src/**/*.sql.ts`），数据库迁移也由 core 应用
- **`packages/app`** — 共享 web UI 组件（SolidJS）
- **`packages/desktop`** — Electron 桌面端，包装 `packages/app`
- **`packages/plugin`** — `@opencode-ai/plugin` 源码
- **`packages/sdk/js`** — JavaScript SDK（自动生成）
- **`packages/llm`**, `packages/console`, `packages/stats`, `packages/enterprise`, `packages/storybook`, `packages/web`, `packages/docs`, `packages/extensions`, `packages/identity`, `packages/slack`, `packages/ui` — 配套包
- **`packages/effect-drizzle-sqlite`**, `packages/effect-sqlite-node` — Effect + Drizzle/SQLite 适配层

### 关键架构概念

1. **Effect 驱动**。`packages/opencode` 全面采用 [Effect](https://effect.website/) v4 beta。任何写新 service 或改异步逻辑的工作都需要先看 `packages/opencode/specs/effect/migration.md` 和 `packages/opencode/AGENTS.md` 的 Effect 部分。要点：
   - 用 `Effect.gen` 组合，`Effect.fn("Domain.method")` 命名/可追踪
   - **Runtime vs InstanceState**：全局共享 service 用 `makeRuntime`（`src/effect/run-service.ts`）；每个打开项目独立、需要清理的 state 用 `InstanceState`（`src/effect/instance-state.ts`，基于 `ScopedCache`，按目录隔离）
   - `Effect.fork` / `forkDaemon` 在 v4 **不存在**——用 `Effect.forkIn(scope)`
   - 错误用 `Schema.TaggedErrorClass`，直接 `yield* new MyError(...)` 而不是 `yield* Effect.fail(...)`
   - 原生/外部回调（`@parcel/watcher`, `node-pty`, plugin callback 等）通过 `EffectBridge` 桥接回 Effect 上下文

2. **模块组织**：**不要用 `export namespace Foo { ... }`**。统一用"平铺顶层导出 + 文件底部 self-reexport"模式：
   ```ts
   // src/foo/foo.ts
   export interface Interface { ... }
   export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
   export const layer = Layer.effect(Service, ...)
   export * as Foo from "./foo"
   ```
   消费者 `import { Foo } from "@/foo/foo"` 后用 `Foo.Service` / `Foo.layer`。
   - 文件是 `foo/index.ts` 时 self-reexport 用 `"."` 不是 `"./index"`
   - **多兄弟目录不加 `index.ts` barrel**（例 `src/session/`、`src/config/`）——barrel 会破坏 tree-shaking，让所有 sibling 都被求值

3. **数据库**：Drizzle schema 文件命名 `*.sql.ts`，集中在 `packages/core/src/`，迁移由 core 包负责。字段名用 **snake_case**（这样列名不用单独再写字符串）：
   ```ts
   sqliteTable("session", {
     id: text().primaryKey(),
     project_id: text().notNull(),
     created_at: integer().notNull(),
   })
   ```

4. **TUI ≠ React**：`packages/opencode/src/cli/cmd/tui/` 用的是 SolidJS + opentui。不要套用 React 心智模型（`useEffect`、`useState` 之类）。

5. **Bun 优先**：用 `Bun.file()` 等 Bun 原生 API 而不是 `node:fs/promises`，能用 Bun 内置就用。

### Style guide 关键约束（违反会被审查打回）

完整版见 `AGENTS.md`，最容易踩坑的几条：

- **避免 `try`/`catch`**——优先用 `.catch(...)` 或 Effect 错误通道
- **禁用 `any` 类型**
- **禁止 `import as` 重命名**（`import { foo as bar }` 不允许）
- **禁止 star imports**（`import * as Foo` 不允许）；需要命名空间就 `import { Foo } from "..."`（依赖模块自己的 self-reexport）
- **避免 `else`**——用 early return
- **避免 `let`**——用 `const` + 三元 / early return
- **避免不必要的解构**——用点号保留上下文（`obj.a` 而不是 `const { a } = obj`）
- **变量只用一次就 inline**，不要预设单值临时变量
- **不要预先抽工具函数**——除非真的复用、隐藏复杂边界、或有清晰独立名字
- **依赖类型推断**——除非 export 边界或可读性需要才显式标类型
- **重模块用动态 `import()`**——但要在窄作用域顶部解构，**不要**写 `(await import("./m")).x()` 这种内联链

### Testing 约定

- **尽量不要 mock**——测真实实现，不要把逻辑复制到测试里
- 测试 **不能从仓库根目录运行**（护栏 `do-not-run-tests-from-root`），必须 `cd` 到包目录

### Debugging（Bun）

Bun 调试比较粗糙，推荐手工启动 + URL 附加调试器：

```bash
bun run --inspect=ws://localhost:6499/ dev ...
# 或为 TUI + server 分别调试
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096
opencode attach http://localhost:4096
```

- 想让断点在 TUI 触发 server 代码时命中，用 `bun dev spawn` 而不是 `bun dev`（后者 server 跑在 worker thread 里，断点可能失效）
- `BUN_OPTIONS=--inspect=ws://localhost:6499/` 可以省掉每次手动加

## Sub-package guidance

很多包有自己的 `AGENTS.md` / `README.md`，提供更细的约定。改某个包之前先看：

- `packages/opencode/AGENTS.md` — 数据库、TUI 调试、模块 shape、完整 Effect 规则
- `packages/app/AGENTS.md`、`packages/desktop/AGENTS.md`、`packages/llm/AGENTS.md`
- `packages/opencode/src/session/llm/AGENTS.md`、`packages/opencode/src/server/routes/instance/httpapi/AGENTS.md`、`packages/opencode/test/AGENTS.md`
- `packages/effect-drizzle-sqlite/AGENTS.md`
- `packages/opencode/specs/effect/*.md` — Effect 迁移、错误、facade、schema、tools 等专项规范
