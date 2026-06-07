# 广东冶建施工图审查中心 AI 工作台 — 设计文档

**日期**：2026-06-07
**作者**：庞定平
**项目代号**：yejian（冶建定制）
**目标读者**：本项目实施者、未来维护者、上游同步操作人

---

## 1. 背景与目标

### 1.1 背景

当前公司 AI 大模型应用以一组 skills / MCP / Python 脚本的形式存在，作者本人在 Trae SOLO / Claude Code 中使用。其他同事不熟悉编程，看到代码会有畏惧感，且让每位同事单独安装并维护 Trae SOLO / Claude Code 成本过高。

### 1.2 目标

基于开源项目 [opencode](https://github.com/anomalyco/opencode) 二次开发一个面向同事的 Web 工作台：

- 同事通过浏览器访问，零安装、零代码恐惧
- 一个 Docker 部署、统一维护
- 所有定制隔离在 `yejian/` 目录，原版 opencode 几乎不动，便于跟随上游更新
- 命名为「广东冶建施工图审查中心 AI 工作台」

### 1.3 非目标（本期不做）

- 真后端权限隔离（多用户系统、用户数据库、API 鉴权、Session 归属、文件路径校验）——留给下一期
- HTTPS / TLS（内网部署，下一期或运维加证书）
- 集群部署、监控告警、日志聚合
- 手机号验证码登录、密码找回流程
- Session 备份/导出工具

---

## 2. 总体原则

1. **最小侵入**：除一行 `file-tree.tsx` 改动外，所有 packages/* 一律不动
2. **物理隔离**：定制代码全部在 `yejian/`，部署文件全部在 `docker/`
3. **复用为先**：opencode 已有的 UI 组件（MessageTimeline、SessionComposerRegion、SessionReviewTab、TerminalPanel）直接 import，不重写
4. **可独立运行**：原版 packages/app 仍能用 `bun dev` 跑出官方界面
5. **大白话部署**：维护流程以固定步骤清单形式提供，不要求维护者理解所有技术细节

---

## 3. 总体架构

### 3.1 部署架构

```
                ┌────────────────────────────────────────┐
                │  宿主机 Windows / Linux Server          │
                │                                          │
                │  D:\AI\AIworkbench\         (工作区)     │
                │  ├─ user-13826001876\                    │
                │  ├─ user-13900000001\                    │
                │  ├─ skills\          (公共资源)          │
                │  └─ shared\          (公共资源)          │
                │                                          │
                │  D:\AI\AIworkbench-data\    (容器数据)   │
                │  ├─ root\.opencode\                      │
                │  └─ tmp\                                  │
                └─────────────────┬────────────────────────┘
                                  │ docker volume mount
                                  ▼
   ┌───────────────────────────────────────────────────────────┐
   │  docker compose（两个容器 + 一份静态 dist，对外仅 :8088）    │
   │                                                            │
   │  ┌──────────────────────────────────────┐                  │
   │  │ nginx                                  │  ← 同事浏览器入口 │
   │  │  - 端口映射 8088:80                    │                  │
   │  │  - basic auth + .htpasswd              │                  │
   │  │  - 静态 serve yejian/dist              │                  │
   │  │  - 反向代理 /api/* /event/* /pty/*     │                  │
   │  │  - 透传 X-User header（手机号）         │                  │
   │  └────────────────┬─────────────────────┘                   │
   │                   │                                          │
   │                   └──→ ┌────────────────────────────────┐    │
   │                        │ opencode-server (内部 4096)     │   │
   │                        │  bun install -g                 │   │
   │                        │    opencode-ai@1.16.2           │   │
   │                        │  cd /workspace                  │   │
   │                        │  opencode serve --hostname 0.0.0.0│ │
   │                        │  挂载 /workspace、/root、/tmp    │   │
   │                        └────────────────────────────────┘   │
   └───────────────────────────────────────────────────────────┘
```

> 实际运行两个容器（nginx + opencode-server）；yejian web 是构建后的静态 dist 目录，由 nginx 直接 serve，不需要独立容器。

### 3.2 仓库结构

```
D:\ai\opencode\                              ← fork from anomalyco/opencode
├─ yejian/                                    ← 所有定制代码
│  ├─ index.html                              ← <title>广东冶建施工图审查中心AI工作台</title>
│  ├─ vite.config.ts                          ← 独立 Vite 配置
│  ├─ tsconfig.json
│  ├─ package.json                            ← workspace 依赖 @opencode-ai/app 等
│  ├─ src/
│  │  ├─ entry.tsx                            ← mount 点
│  │  ├─ App.tsx                              ← 路由 + Provider 链
│  │  ├─ pages/
│  │  │  └─ SessionPage.tsx                   ← 四列布局定制页面
│  │  ├─ components/
│  │  │  ├─ PanelOne.tsx                      ← 左侧面板一（技能/通用会话/设置）
│  │  │  ├─ PanelTwo.tsx                      ← 左侧面板二（项目-Session 树）
│  │  │  ├─ SkillTooltip.tsx                  ← 技能悬浮提示
│  │  │  └─ ErrorBoundary.tsx                 ← 中文化错误边界
│  │  ├─ config/
│  │  │  ├─ skills.json                       ← 所有技能配置
│  │  │  └─ app.ts                            ← 项目前缀、端口等常量
│  │  ├─ hooks/
│  │  │  ├─ useCurrentUser.ts                 ← 读 X-User header（注入到 window）
│  │  │  ├─ useProjects.ts                    ← 项目列表（按当前用户过滤）
│  │  │  └─ useUiPreference.ts                ← localStorage 折叠状态
│  │  └─ utils/
│  │     └─ phoneMask.ts                      ← 手机号打码显示
│  └─ Dockerfile.unused                       ← yejian 自身不需要容器，预留
├─ docker/                                    ← 部署相关
│  ├─ docker-compose.yml
│  ├─ .env.example                            ← WORKSPACE_PATH / DATA_PATH / OPENCODE_VERSION
│  ├─ nginx/
│  │  ├─ Dockerfile                           ← nginx:alpine + htpasswd 工具
│  │  ├─ nginx.conf                           ← basic auth + 反代 + X-User
│  │  └─ htpasswd.example                     ← 账号文件模板
│  ├─ opencode-server/
│  │  └─ Dockerfile                           ← bun + opencode-ai@1.16.2
│  └─ scripts/
│     ├─ healthcheck.bat                      ← Windows 一键体检
│     ├─ healthcheck.sh                       ← Linux 一键体检
│     ├─ add-user.bat                         ← 增加同事账号一键脚本
│     └─ rebuild-web.bat                      ← 重建 yejian/dist 一键脚本
├─ docs/superpowers/specs/
│  └─ 2026-06-07-yejian-customization-design.md   ← 本文档
├─ packages/app/src/components/file-tree.tsx  ← 【唯一侵入式改动：1 行 filter】
└─ .gitignore                                  ← 已加 .superpowers/
```

### 3.3 技术栈

- **前端**：SolidJS + Vite + TypeScript（与 packages/app 同栈，确保组件复用无障碍）
- **后端**：opencode CLI（bun 实现），版本固定 1.16.2
- **反向代理 + 认证**：nginx + basic auth (.htpasswd, bcrypt)
- **容器编排**：docker compose v2

---

## 4. yejian 前端详细设计

### 4.1 路由

```
/                                  → 跳转到当前用户默认项目
/yejian/:dir/session/:id?          → 主工作台页面
```

- `:dir` 沿用 opencode 约定：base64 编码的绝对路径（如 base64encode("/workspace/user-13826001876")）
- `:id` 可选；缺失时显示「新建会话」空态
- 不再使用 opencode 官方的 `/:dir/session/:id?`——前缀 `/yejian/` 避免与官方路由混淆，原版仍可在 `bun dev` 下访问

### 4.2 Provider 链

```tsx
<MetaProvider>
  <Router root={(props) => (
    <PlatformProvider>
      <AppBaseProviders>          // import from @opencode-ai/app
        <Title>广东冶建施工图审查中心AI工作台</Title>
        {props.children}
      </AppBaseProviders>
    </PlatformProvider>
  )}>
    <Route path="/yejian/:dir" component={DirectoryLayout}>      // 复用官方
      <Route path="/session/:id?" component={SessionPage} />     // 自写
    </Route>
  </Router>
</MetaProvider>
```

`<SessionPage>` 内部再套 `<SessionProviders>`（来自 packages/app，提供 Terminal/File/Prompt/Comments 上下文）。

### 4.3 SessionPage 布局

四列横向 grid + 底部终端（高度独立）：

```
┌──────────────┬──────────────┬───────────────────┬───────────────┐
│ 面板一 180px │ 面板二 220px │ 主区 flex:1       │ 右侧 280px    │
│              │              │ ┌───────────────┐ │               │
│              │              │ │MessageTimeline│ │ SessionReview │
│              │              │ │（flex:1）      │ │ Tab           │
│              │              │ └───────────────┘ │               │
│              │              │ ┌───────────────┐ │               │
│              │              │ │Composer       │ │               │
│              │              │ └───────────────┘ │               │
├──────────────┴──────────────┴───────────────────┴───────────────┤
│ TerminalPanel（高度 30vh，可隐藏）                                │
└─────────────────────────────────────────────────────────────────┘
```

- 列宽：用 CSS grid + resize（可拖动改宽，宽度记忆到 localStorage）
- 面板二、右侧审查、底部终端均可隐/显，状态记忆
- 首次访问：右侧 + 终端默认隐藏；面板一、面板二默认显示
- 用户操作后：localStorage 记忆，下次自动恢复

### 4.4 左侧面板一（PanelOne）

#### 4.4.1 结构

```
┌─────────────────────┐
│ 💬 通用会话         │  ← 顶部固定
│                     │
│ 🛠 技能会话      ▾  │  ← 顶级开关
│   📁 日常办公   ▸/▾ │
│      · 生成PPT(灰)  │  ← 占位
│      · PDF转MD     │
│      · ...         │
│   📁 审查相关  ▸/▾  │
│   📁 党群文章 ▸/▾   │
│   📁 经营投标 ▸/▾   │
│   📁 财务相关 ▸/▾   │
│   📁 多模态  ▸/▾    │
│   📁 其它    ▸/▾    │
│                     │
│ ⚙ 设置              │  ← 底部固定
└─────────────────────┘
```

#### 4.4.2 数据源 — `yejian/src/config/skills.json`

```jsonc
{
  "groups": [
    {
      "id": "office",
      "name": "日常办公",
      "skills": [
        { "id": "ppt-gen", "name": "生成PPT", "placeholder": true },
        {
          "id": "online-to-md",
          "name": "PDF转MD",
          "invokeName": "online-to-md",
          "prompt": "调用技能 online-to-md，请把以下 PDF 转为 Markdown：\n【请粘贴 PDF 链接或在 chat 中上传 PDF 文件】",
          "tooltip": {
            "detail": "把在线 PDF 或本地 PDF 转换为 Markdown 文档，保留章节、表格、图片描述。",
            "keywords": ["PDF", "online-to-md", "MD 转换"],
            "example": "把 https://xxx.pdf 转为 Markdown，输出到当前项目目录"
          }
        }
        // ... 生成提示词(占位)、会议纪要(占位)、公司制度查询(占位)、制度数据更新(占位)
      ]
    },
    {
      "id": "review",
      "name": "审查相关",
      "skills": [
        { "id": "green-building", "name": "绿建审查", "invokeName": "Green-Building-Design-Review", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "energy-saving", "name": "节能审查", "placeholder": true },
        { "id": "general-spec-review", "name": "总说明审查", "placeholder": true },
        { "id": "city-pdf-download", "name": "市系统下载PDF", "invokeName": "review-drawing-downloader", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "province-pdf-download", "name": "省系统下载PDF", "placeholder": true },
        { "id": "current-spec-numbers", "name": "现行规范编号", "invokeName": "current-spec-numbers", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "current-atlas", "name": "现行图集", "invokeName": "current-atlas", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "spec-auto-update", "name": "规范图集自更新", "invokeName": "specification-auto-update", "prompt": "...", "tooltip": { /* ... */ } }
      ]
    },
    {
      "id": "party",
      "name": "党群文章",
      "skills": [
        { "id": "propaganda", "name": "宣传稿撰写", "placeholder": true },
        { "id": "party-article", "name": "党建文章", "placeholder": true },
        { "id": "doc-format", "name": "公文排版", "invokeName": "document-format", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "wechat-publish", "name": "公众号一键发布", "placeholder": true },
        { "id": "polish", "name": "文章润色", "placeholder": true },
        { "id": "expand", "name": "文本扩写", "placeholder": true },
        { "id": "shrink", "name": "文本缩写", "placeholder": true },
        { "id": "rewrite", "name": "文本改写", "placeholder": true },
        { "id": "continue", "name": "文本续写", "placeholder": true },
        { "id": "summarize", "name": "文章总结", "placeholder": true },
        { "id": "wechat-data-update", "name": "公众号数据自更新", "placeholder": true }
      ]
    },
    {
      "id": "business",
      "name": "经营投标",
      "skills": [
        { "id": "biz-bid", "name": "商务标生成", "placeholder": true },
        { "id": "tech-bid", "name": "技术标生成", "placeholder": true },
        { "id": "contract-review", "name": "合同审查", "placeholder": true },
        { "id": "intel", "name": "刺探情报", "placeholder": true },
        { "id": "tender-info", "name": "招标信息", "placeholder": true },
        { "id": "biz-dashboard", "name": "经营数据看板", "placeholder": true }
      ]
    },
    {
      "id": "finance",
      "name": "财务相关",
      "skills": [
        { "id": "receipt", "name": "票据信息采集", "placeholder": true },
        { "id": "data-analysis", "name": "数据分析", "placeholder": true },
        { "id": "table-sort", "name": "表格整理", "placeholder": true },
        { "id": "finance-dashboard", "name": "财务数据看板", "placeholder": true }
      ]
    },
    {
      "id": "multimodal",
      "name": "多模态",
      "skills": [
        { "id": "text2image", "name": "文生图", "placeholder": true },
        { "id": "image2text", "name": "图生文", "placeholder": true },
        { "id": "tts", "name": "文本转语音", "invokeName": "edge-tts", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "stt", "name": "语音转文本", "placeholder": true },
        { "id": "video-make", "name": "视频制作", "placeholder": true },
        { "id": "video-summary", "name": "视频总结", "placeholder": true }
      ]
    },
    {
      "id": "misc",
      "name": "其它",
      "skills": [
        { "id": "thought", "name": "梳理思路", "invokeName": "thought-clarifier", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "decision", "name": "个人决策顾问", "invokeName": "personal-decision-advisor", "prompt": "...", "tooltip": { /* ... */ } },
        { "id": "hallucination", "name": "幻觉检测", "placeholder": true },
        { "id": "brainstorm", "name": "头脑风暴", "placeholder": true },
        { "id": "humanizer", "name": "文章去AI味", "invokeName": "humanizer", "prompt": "...", "tooltip": { /* ... */ } }
      ]
    }
  ]
}
```

**字段约定**：

> 注：上面 JSON 中 `"prompt": "..."` 与 `"tooltip": { ... }` 内的省略号是示例骨架，实现期需要由作者逐条填入实际的提示词模板与说明文案，详见 §12 附录中"可用"那一行对应的技能。

| 字段 | 必填 | 含义 |
|---|---|---|
| `id` | 是 | 程序用唯一标识（kebab-case） |
| `name` | 是 | 中文显示名 |
| `placeholder` | 否 | true=灰色占位；false 或缺省=正常可用 |
| `invokeName` | 占位为否，否则是 | 实际技能调用名（与 SKILL.md 中的 name 一致） |
| `prompt` | 占位为否，否则是 | 点击后填入输入框的完整提示词，可含 `【...】` 占位提示 |
| `tooltip.detail` | 占位为否，否则是 | Tooltip 第一段：技能详细说明 |
| `tooltip.keywords` | 否 | Tooltip 第二段：调用关键词数组 |
| `tooltip.example` | 否 | Tooltip 第三段：使用案例 |

构建时：在 vite 插件里用一个 ajv schema 校验该 JSON，结构错误直接构建失败。

#### 4.4.3 交互

| 操作 | 行为 |
|---|---|
| 点击「通用会话」 | 进入「通用模式」：仅切换高亮状态，输入框内容、当前 session 都不变。"通用模式"与"技能模式"在程序行为上无差异，仅用于视觉提示当前操作语境；后续若有差异化需求再扩展。 |
| 点击「技能会话」 | 顶级手风琴：折叠/展开所有技能分组（折叠时仅显示分组名） |
| 点击某个分组 | 仅切换该分组展开/折叠，其他分组保持不变 |
| 点击占位技能 | 无响应，Tooltip 显示「功能开发中」 |
| 点击正常技能 | 用 `prompt` **覆盖** SessionComposerRegion 当前 textarea 的内容；focus textarea；光标定位到第一个 `【...】` 占位的起始位置；不自动发送 |
| 鼠标悬浮技能 | 300ms 延迟后显示 Tooltip |
| 点击「设置」 | 调用 opencode 原 Session 设置面板（同 `useSettings` 或对应 store 触发） |

**实现细节**：

- 输入框填充：SessionComposerRegion 内部状态由 `createSessionComposerState` 管理。yejian 通过自己包一层 PromptContext + signal，在外部触发 setter（如果 opencode 没有直接暴露 setter，则通过 PromptContext 桥接）。实现期第一项验证任务。
- 设置面板触发：opencode 设置面板的打开方式（dialog / route / store action）需在实现期前置探索；若 opencode 内部没有可调用 API，则降级为外链按钮（打开 `/:dir/session/settings` 之类）。

### 4.5 左侧面板二（PanelTwo）

#### 4.5.1 数据流

```
useCurrentUser() ─→ phone (e.g. 13826001876)
                       │
                       ▼
useProjects(phone) ─→ 调 SDK 拉 /workspace 下所有以 user- 开头的目录
                       │ 仅保留 user-<phone> 这一个（隐私 UI 过滤）
                       ▼
useProjectSessions(dir) ─→ 项目展开时拉该目录下 session 列表（按 updatedAt desc）
```

`useCurrentUser` 实现：

1. nginx 把 `X-User: <phone>` 写入响应 header（通过一个 `/me` 接口或注入到 index.html meta tag）
2. 推荐方案：nginx 在 serve `index.html` 时 `sub_filter` 把 `<meta name="x-user" content="__USER__">` 替换为真实手机号
3. 前端 `useCurrentUser` 读这个 meta tag

#### 4.5.2 结构

```
┌──────────────────────┐
│ 项目列表  [刷新] [◀] │  ← 顶栏
│                      │
│ 📁 138****1876  ▾    │  ← 当前用户唯一项目，鼠标悬浮显示完整号码
│    💬 绿建审查-A     │
│       2 小时前        │
│    💬 节能审查-B     │
│       昨天            │
│    💬 + 新建会话     │
└──────────────────────┘
```

#### 4.5.3 交互

| 操作 | 行为 |
|---|---|
| 点击项目名 | 手风琴展开/折叠（本期只有一个项目，仍按规则实现以便未来扩展） |
| 点击 Session | 路由到 `/yejian/<base64(dir)>/session/<id>` |
| 点击 + 新建会话 | 调 `sdk.client.session.create({ directory: dir })`，跳到新 session |
| 点击 [刷新] | 重拉项目列表 + 已展开项目的 session 列表 |
| 点击 [◀] | 折叠整个面板二，主区扩展；状态写 localStorage |
| 鼠标悬浮项目名 | Tooltip 显示完整手机号 |
| 鼠标悬浮 Session 时间 | Tooltip 显示绝对时间（如 2026-06-07 14:23） |

#### 4.5.4 手机号打码规则

```ts
// yejian/src/utils/phoneMask.ts
export function maskPhone(phone: string): string {
  if (!/^1\d{10}$/.test(phone)) return phone
  return phone.slice(0, 3) + "****" + phone.slice(7)
}
```

### 4.6 主区与右侧、底部（复用官方）

| 区域 | 组件 | 来源 |
|---|---|---|
| MessageTimeline | `<MessageTimeline />` | `@opencode-ai/app/.../pages/session/message-timeline` |
| 底部输入框 | `<SessionComposerRegion />` | `.../session/composer` |
| 右侧审查面板 | `<SessionReviewTab />` | `.../session/review-tab` |
| 底部终端 | `<TerminalPanel />` | `.../session/terminal-panel` |

直接 import，不重写。

### 4.7 错误处理

- 整个 `<SessionPage>` 套 `<ErrorBoundary>`（yejian 自己的中文化版本）
- 错误兜底 UI：
  ```
  ⚠️ 出现了一个问题
  请尝试刷新页面。如果问题持续，请把以下信息发给管理员：
  [复制错误详情]  [刷新页面]
  ```
- 关键错误自动写入 `console.error` 并 toast 提示
- API 失败：30s 超时；toast「后端无响应，请稍后重试」+ 重试按钮

---

## 5. 上游侵入式改动清单

本次开发**唯一**的 packages/* 改动：

### 5.1 packages/app/src/components/file-tree.tsx

在 `nodes()` 函数（约第 327 行）内部添加一行 filter：

```ts
// 过滤掉以 . 开头的目录（如 .git、.opencode、.superpowers）
nodes = nodes.filter((n) => !n.name.startsWith("."))
```

具体插入位置：`const out = nodes.filter(...)` 之后；以及第 350-374 行 `current.dirs/files` 合并循环结果末尾。

**冲突应对**：上游每次同步如果该文件冲突，按本节描述重新 patch；若上游大改 `nodes()` 已不存在，则改用 yejian 自写包装器（在 yejian 内 `useFile()` 生成过滤后的 `allowed` 数组传给原 FileTree）。

### 5.2 packages/app/src/index.ts

`@opencode-ai/app` 当前只 re-export `AppBaseProviders`、`AppInterface` 等顶层组件，未暴露 SessionPage 内部 region。yejian 要复用这些 region 必须先把它们 export 出来：

```ts
// 在 packages/app/src/index.ts 末尾追加（约 9 行）
export { MessageTimeline } from "./pages/session/message-timeline"
export {
  SessionComposerRegion,
  createSessionComposerState,
} from "./pages/session/composer"
export { SessionReviewTab } from "./pages/session/review-tab"
export { SessionSidePanel } from "./pages/session/session-side-panel"
export { TerminalPanel } from "./pages/session/terminal-panel"
// 上下文 hooks（yejian 数据获取依赖）
export { useSDK } from "./context/sdk"
export { useSync } from "./context/sync"
export { useFile } from "./context/file"
```

**冲突应对**：上游若重构这些组件路径或导出名，每次同步上游后需同步更新此处。冲突解决比 file-tree.tsx 更直接（改路径而非合并逻辑）。

### 5.3 根 `.gitignore`

```
.superpowers/
```

（已添加）

**这三处之外，packages/* 一律不动**。

---

## 6. Docker 部署详细设计

### 6.1 docker/.env.example

```bash
# 工作区（用户项目目录 + 公共资源所在地）
WORKSPACE_PATH=D:/AI/AIworkbench

# 容器持久化数据（opencode 配置缓存、tmp）
DATA_PATH=D:/AI/AIworkbench-data

# opencode CLI 固定版本（升级时改这里 + 重建 opencode-server）
OPENCODE_VERSION=1.16.2

# 对外端口
WEB_PORT=8088
```

### 6.2 docker/docker-compose.yml（要点）

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

### 6.3 docker/nginx/nginx.conf（要点）

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
  include /etc/nginx/mime.types;
  sendfile on;

  upstream opencode_backend {
    server opencode-server:4096;
  }

  server {
    listen 80;
    server_name _;
    charset utf-8;

    # 错误页面中文化
    error_page 502 503 504 /50x.html;
    location = /50x.html {
      default_type text/html;
      return 502 '<html><body><h1>后端服务暂时不可用</h1><p>请联系管理员或稍后重试。</p></body></html>';
    }

    # 所有路径都要 basic auth
    auth_basic "广东冶建施工图审查中心 AI 工作台";
    auth_basic_user_file /etc/nginx/htpasswd;

    # 把用户名透传到下游（注入到 index.html 与 API 请求）
    proxy_set_header X-User $remote_user;

    # 后端 API / 事件 / 终端
    location ~ ^/(api|event|pty|ws)/ {
      proxy_pass http://opencode_backend;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header X-User $remote_user;
      proxy_read_timeout 86400s;
    }

    # 静态文件（含 index.html）
    location / {
      root /usr/share/nginx/html;
      try_files $uri /index.html;

      # 注入手机号到 meta tag（前端 useCurrentUser 读取）
      sub_filter '<meta name="x-user" content="__USER__">' '<meta name="x-user" content="$remote_user">';
      sub_filter_once on;
      sub_filter_types text/html;
    }
  }
}
```

### 6.4 yejian/index.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>广东冶建施工图审查中心AI工作台</title>
  <meta name="x-user" content="__USER__" />   <!-- nginx 启动时替换 -->
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/entry.tsx"></script>
</body>
</html>
```

### 6.5 docker/opencode-server/Dockerfile

```dockerfile
FROM oven/bun:1.3-alpine
ARG OPENCODE_VERSION
RUN bun add -g opencode-ai@${OPENCODE_VERSION}
WORKDIR /workspace
EXPOSE 4096
ENTRYPOINT ["opencode", "serve", "--port", "4096", "--hostname", "0.0.0.0"]
```

### 6.6 docker/scripts/healthcheck.bat（Windows 一键体检脚本）

```bat
@echo off
chcp 65001 >nul
echo === AI 工作台健康检查 ===
echo.
echo [1/5] 容器状态：
docker compose -f docker-compose.yml ps
echo.
echo [2/5] 最近 30 行日志（opencode-server）：
docker compose -f docker-compose.yml logs --tail=30 opencode-server
echo.
echo [3/5] 最近 30 行日志（nginx）：
docker compose -f docker-compose.yml logs --tail=30 nginx
echo.
echo [4/5] 检查工作区目录：
dir "%WORKSPACE_PATH%"
echo.
echo [5/5] 检查 opencode 日志目录：
dir "%DATA_PATH%\root\.opencode\logs"
echo.
echo === 检查完成 ===
pause
```

Linux 等价版本 `healthcheck.sh` 同理。

### 6.7 docker/scripts/add-user.bat（增加同事一键脚本）

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

echo 正在生成密码（请输入两遍密码）...
docker run --rm -it -v %CD%\nginx:/etc/nginx httpd:alpine htpasswd -B /etc/nginx/htpasswd %PHONE%

if not exist "%WORKSPACE_PATH%\user-%PHONE%" mkdir "%WORKSPACE_PATH%\user-%PHONE%"
echo.
echo 完成：账号 %PHONE% 已添加，项目目录 %WORKSPACE_PATH%\user-%PHONE% 已创建。
echo 同事现在可以打开 http://你的服务器IP:8088 用此手机号登录。
pause
```

### 6.8 docker/scripts/rebuild-web.bat

```bat
@echo off
chcp 65001 >nul
echo === 重新构建 yejian web ===
cd ..\..\yejian
call bun install
call bun run build
echo 完成。nginx 会自动 serve 新文件，无需重启。
pause
```

### 6.9 首次部署流程（给维护者的固定步骤）

```bash
# 1. fork & clone（如果还没做）
git clone https://github.com/PangDingPing/opencode.git
cd opencode
git remote add upstream https://github.com/anomalyco/opencode.git
git checkout -b yejian-main

# 2. 准备宿主目录
mkdir D:\AI\AIworkbench
mkdir D:\AI\AIworkbench-data\root
mkdir D:\AI\AIworkbench-data\tmp

# 3. 构建 web
cd yejian
bun install
bun run build

# 4. 准备配置
cd ..\docker
copy .env.example .env
# 编辑 .env：检查路径

# 5. 创建第一个账号（管理员自己）
scripts\add-user.bat
# 按提示输入手机号 + 密码

# 6. 启动
docker compose up -d

# 7. 浏览器访问 http://localhost:8088 验证
```

### 6.10 维护操作清单

| 任务 | 命令 |
|---|---|
| 加同事 | `docker\scripts\add-user.bat` |
| 改了 yejian/ 代码后更新 | `docker\scripts\rebuild-web.bat` |
| 改了 skills.json 后更新 | 同上 |
| 升级 opencode 版本 | 改 `.env` 的 `OPENCODE_VERSION`，然后 `docker compose build --no-cache opencode-server && docker compose up -d opencode-server` |
| 健康检查 | `docker\scripts\healthcheck.bat` |
| 看实时日志 | `docker compose logs -f` |
| 重启 | `docker compose restart` |
| 完全重启 | `docker compose down && docker compose up -d` |

---

## 7. Git 工作流与上游同步

### 7.1 Remote 设置（一次性）

```bash
cd D:/ai/opencode
git remote rename origin upstream                  # 原 origin → upstream
git remote add origin https://github.com/PangDingPing/opencode.git
git checkout -b yejian-main upstream/dev
git push -u origin yejian-main
```

### 7.2 fork 仓库默认分支调整

GitHub 上 `https://github.com/PangDingPing/opencode` → Settings → Branches → default 改为 `yejian-main`。

> 注：本项目不计划向上游 PR 回贡，故 fork 的 `dev` 分支可以不主动同步；只需在本地保留 `upstream` remote 用于拉取代码。

### 7.3 日常提交

```bash
git checkout yejian-main
git add yejian/ docker/ packages/app/src/components/file-tree.tsx
git commit -m "feat(yejian): 描述"
git push origin yejian-main
```

### 7.4 同步上游（每周或大版本）

```bash
git checkout yejian-main
git fetch upstream
git log yejian-main..upstream/dev --oneline    # 看上游有什么新东西
git merge upstream/dev
# 若冲突（99% 概率在 file-tree.tsx），用 VS Code 可视化合并工具解决：
#   - 保留 yejian 那行 .filter
#   - 上游其它改动全部接受
git push origin yejian-main
```

### 7.5 你只需要会的 8 个 git 命令

```
git status
git diff
git add <文件>
git commit -m "..."
git push origin yejian-main
git fetch upstream
git merge upstream/dev
git log --oneline -10
```

冲突全部用 VS Code 的合并 UI 解决，不要在命令行 vim 里改。

---

## 8. 错误处理总览

### 8.1 启动期

| 故障 | 表现 | 处理 |
|---|---|---|
| WORKSPACE_PATH 不存在 | opencode-server 启动失败 | docker-compose 启动前置校验脚本提示 |
| htpasswd 缺失 | nginx 启动失败 | 同上 |
| yejian/dist 不存在 | nginx 404 | 提示「请先运行 rebuild-web.bat」 |
| opencode 版本不兼容 | 进入页面后 API 报错 | 文档锁定 1.16.2；ErrorBoundary 中文提示 |

### 8.2 运行期

| 故障 | 表现 | 处理 |
|---|---|---|
| opencode-server 容器挂了 | API 502 | `restart: unless-stopped` 自动重启；前端 toast「后端服务暂时不可用」 |
| 用户项目目录被删 | 面板二空白 | 「未找到您的项目目录，请联系管理员」 |
| Session 列表加载失败 | 转圈不停 | 30s 超时 + 重试按钮 |
| WebSocket 断开 | 终端卡死 | opencode 内置重连；前端不干预，提示用户刷新 |
| skills.json 写错 | 面板一空白 | 构建时 ajv 校验失败拦截；运行时 try-catch 降级 |
| 前端组件崩溃 | 白屏 | ErrorBoundary 兜底，「[复制错误详情] [刷新页面]」 |

### 8.3 所有面向用户的文本一律中文

包括：
- 前端 toast、错误页、空态文案
- nginx 错误页（502/504）
- 一键脚本输出

---

## 9. 验收标准

### 9.1 功能验收

1. 同事用手机号 + 密码登录后能看到只属于自己的项目
2. 面板一按设计渲染所有技能；占位技能灰色不可点；正常技能点击后输入框被覆盖为预设提示词
3. 鼠标悬浮技能显示 Tooltip（含详情、关键词、案例）；占位技能悬浮显示「功能开发中」
4. 面板二能展开当前用户项目并列出 session（含相对时间）
5. 点击 + 新建会话能建出 session 并跳转
6. 面板二、右侧审查、底部终端可隐/显，状态记忆到 localStorage
7. 文件树不显示以 . 开头的目录
8. 网页标题为「广东冶建施工图审查中心AI工作台」

### 9.2 部署验收

1. `docker compose up -d` 一条命令起服务
2. `add-user.bat` 一条命令加同事
3. `healthcheck.bat` 一条命令体检
4. `rebuild-web.bat` 一条命令更新前端
5. 改 `.env` 的版本号 + 一条命令升级 opencode

### 9.3 上游同步验收

1. `git fetch upstream && git merge upstream/dev` 在「上游未改 file-tree.tsx」时无冲突
2. 文档 §7.4 步骤可重复执行，每次产出可发布的 yejian-main

### 9.4 兼容性验收

1. `cd packages/app && bun dev` 仍能跑出原版界面（不受 yejian/ 干扰）
2. 删除 yejian/ 目录后，仓库等价于 fork + 一行 file-tree 改动 + .gitignore 改动

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| opencode 升级把 SessionComposerRegion / TerminalPanel 等导出改了 | 锁定 1.16.2；升级前先在测试环境跑一遍验收清单 |
| `createSessionComposerState` 不暴露 setter，导致技能点击无法填充输入框 | 实现期第一项验证；备选方案：通过 PromptContext 桥接，或 fork 一份 composer 到 yejian |
| 用户上传大文件导致 nginx body 限制报错 | nginx.conf 配 `client_max_body_size 100M` |
| 同事忘记密码 | 管理员用 `add-user.bat` 重置（htpasswd 覆盖） |
| 同事 A 通过 F12 构造请求看到同事 B 的数据 | 本期接受此风险；下一期实现真后端隔离 |
| Windows 路径斜杠 / 反斜杠混用 | docker-compose 全部用正斜杠；脚本里注意 `%WORKSPACE_PATH%` 引号 |

---

## 11. 下一期（不在本次范围）

明确列出避免范围蔓延：

- 真·多用户系统：用户数据库、API 鉴权中间件、Session 归属校验、文件路径强制校验
- HTTPS / TLS 证书
- 手机号验证码登录、短信网关、密码自助找回
- 多机部署 / 负载均衡 / 集群
- 监控告警（Prometheus / Grafana）、日志聚合（ELK）
- Session 导出 / 备份工具
- 公司知识库 RAG 接入（如真要做，作为新 skill 接入而非动后端）
- 移动端适配

---

## 12. 附录：技能调用名汇总

供 SKILL.md 与 skills.json 交叉核对：

| 中文名 | invokeName | 状态 |
|---|---|---|
| PDF转MD | online-to-md | 可用 |
| 绿建审查 | Green-Building-Design-Review | 可用 |
| 市系统下载PDF | review-drawing-downloader | 可用 |
| 现行规范编号 | current-spec-numbers | 可用 |
| 现行图集 | current-atlas | 可用 |
| 规范图集自更新 | specification-auto-update | 可用 |
| 公文排版 | document-format | 可用 |
| 文本转语音 | edge-tts | 可用 |
| 梳理思路 | thought-clarifier | 可用 |
| 个人决策顾问 | personal-decision-advisor | 可用 |
| 文章去AI味 | humanizer | 可用 |
| 其余带 * 的 | — | 占位（本期不实现，仅 UI 占位） |

---

**文档结束**
