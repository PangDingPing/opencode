# 计划：index 页面增加左侧悬浮技能框

## 1. 任务概述

在 `packages/app` 的首页（路由 `/`，由 `packages/app/src/pages/home.tsx` 渲染）最左侧、垂直方向中间位置，新增一个**悬浮技能框**入口与抽屉。

- 入口：`yejian/技能库.png`（贴左、垂直居中），hover 时像抽屉一样向右拉开
- 抽屉内容：7 个技能分组（日常办公 / 审查相关 / 党群文章 / 经营投标 / 财务相关 / 多模态 / 其它）
- 分组点击：**手风琴式**展开/折叠（其它分组保持原状）
- 状态记忆：分组折叠/展开状态写入持久化存储
- 技能项：hover 显示 Tooltip（名称、详情、调用关键词、使用案例；未开发显示"功能开发中"）
- 点击技能：把预设的技能提示词写入 `<div data-component="prompt-input" role="textbox" contenteditable="true" ...>`，并隐藏悬浮框
- 数据：技能分组、技能、Tooltip、预设提示词都从 JSON 动态加载
- 占位规则：技能名以 `*` 开头表示"功能开发中"，渲染为灰色、Tooltip 显示"功能开发中"
- 数据加载失败 / 数据量超出可视区域：抽屉右侧加滚动条
- prompt-input 占位文字：改为"请输入交互内容。提示：/ 调用技能；ctrl+\ 显示文件树"

## 2. 当前状态分析

### 关键文件（已读）

- `packages/app/src/pages/home.tsx` — 首页
  - 第 116-123 行：`Home` 入口，根据 `settings.general.newLayoutDesigns()` 在 `HomeDesign` / `LegacyHome` 间切换
  - 第 340-435 行：`HomeDesign` 渲染容器 `rounded-[10px] shadow-[...]` + 居中 grid（`max-w-[1080px]`），左侧 280px 项目栏 + 右侧 720px 会话栏
  - 第 1096-1217 行：`LegacyHome`（旧版布局）：`<div class="mx-auto mt-55 w-full md:w-auto px-4">` 居中，`<Logo class="md:w-xl opacity-12" />` 在背景
  - 悬浮框需要**覆盖在所有内容之上**，所以必须渲染在两个分支的**外层**而不是内部
- `packages/app/src/app.tsx` — 第 412 行：`<Route path="/" component={HomeRoute} />`
- `packages/app/src/entry.tsx` — 第 70-78 行：系统通知相关，与本任务无关
- `packages/app/src/components/prompt-input.tsx` — 第 1338-1341 行：
  ```ts
  const designPlaceholder = () => {
    if (store.mode === "shell") return placeholder()
    return "Ask anything, / for commands, @ for context..."
  }
  ```
  这是要改的占位文字（在 `legacy placeholder` 之外还有一个 `designPlaceholder` 用于新设计）
- `packages/app/src/components/prompt-input/placeholder.ts` — `promptPlaceholder` 旧版占位函数
- `packages/app/src/utils/persist.ts` — 持久化工具，导出 `Persist` / `persisted`（已被 prompt-input 用来存历史）
- `packages/app/src/pages/home.tsx` 中第 1151 行的 `<Logo>` 是 LegacyHome 背景图，与本任务无关
- `packages/ui/src/components/tooltip.tsx` 和 `packages/ui/src/v2/components/tooltip-v2.tsx` — Tooltip 组件（v1 用法：`<Tooltip value={...}>{trigger}</Tooltip>`）
- `packages/app/public/` 已有 `LOGO1.ico`、`favicon.ico` 等静态资源，`vite` 默认会把 `public/` 整个暴露在根路径下

### 数据写入 prompt-input 的方式

`<div data-component="prompt-input" role="textbox" contenteditable="true" ...>` 是 SolidJS 编辑器实例。
**不应**直接用 `innerText` 覆盖（会破坏它的内部状态 / 光标位置）。
正确做法：

1. 通过 `document.querySelector('[data-component="prompt-input"]')` 找到元素
2. 派发 React/Solid 不友好的 `input` 事件之前，先用 Solid 的响应式状态来"告知" prompt-input 状态

更简单的方案：
- 通过 `document.querySelector('[data-component="prompt-input"]')` 拿到 `editorRef`
- 利用 `prompt-input/editor-dom.ts` 暴露的 `createTextFragment` / `setRangeEdge` 工具，把文本片段插入到编辑器
- 然后触发 `input` 事件让 Solid 同步

考虑到工具方法在内部 `prompt-input/editor-dom.ts` 是模块私有函数，**最稳妥的做法是：**
- 通过 `document.querySelector('[data-component="prompt-input"]')` 拿到元素
- **清空**（`el.innerHTML = ''` + 触发 input 事件）
- **插入**：`const text = document.createTextNode(prompt); el.appendChild(text); el.dispatchEvent(new InputEvent('input', {bubbles: true}))`
- 聚焦并把光标移到末尾

这种 DOM 操作虽然不算最优雅，但与现有代码（参见 `prompt-input/editor-dom.ts`）的策略保持一致——它就是直接操作 DOM 的。

### 状态持久化

仿照 `prompt-input.tsx:357-364` 的 `persisted(Persist.global(...), createStore(...))` 用法存分组状态：
- 存储 key：`"opencode.global.dat:skills-panel"`
- 字段：`{ expandedGroups: Record<string, boolean> }`

## 3. 具体改动

### 3.1 新增静态资源

- 把 `yejian/技能库.png` 复制到 `packages/app/public/yejian/技能库.png`
- 新建 `packages/app/public/yejian/技能.json`（数据按下面 schema 设计）

#### JSON Schema（`packages/app/public/yejian/技能.json`）

```json
{
  "version": 1,
  "groups": [
    {
      "id": "daily-office",
      "name": "日常办公",
      "skills": [
        {
          "name": "生成PPT",
          "developing": true,
          "tooltip": "功能开发中",
          "keyword": "生成PPT",
          "case": "功能开发中",
          "prompt": "[开发中] 请使用 生成PPT 技能。"
        },
        {
          "name": "PDF转MD",
          "developing": false,
          "skillId": "online-to-md",
          "tooltip": "使用 MinerU API 将 PDF / Word / PPT / 图片精准解析为 Markdown。",
          "keyword": "/online-to-md <文件路径或URL>",
          "case": "把 /Users/me/report.pdf 转成 Markdown",
          "prompt": "请使用 online-to-md 技能，把以下文件转成 Markdown："
        }
      ]
    }
  ]
}
```

完整 7 个分组 + 全部技能（按用户列出的列表），每个技能含：

| 字段 | 含义 |
| --- | --- |
| `name` | 显示名 |
| `developing` | true=占位灰色；false=已开发 |
| `skillId?` | 调用的技能 ID（与 `D:\AI\AIworkbench\.opencode\skills\<dir>` 对应） |
| `tooltip` | Tooltip 详情段 |
| `keyword` | 调用关键词段（Tooltip 中显示） |
| `case` | 使用案例段（Tooltip 中显示） |
| `prompt` | 点击后填入 prompt-input 的预设文字 |

各技能映射（按 `D:\AI\AIworkbench\.opencode\skills` 实际目录校对）：

- **日常办公**
  - `*生成PPT`（占位）
  - `PDF转MD` → `online-to-md`
  - `*生成提示词`（占位）
  - `*会议纪要`（占位）
  - `*公司制度查询`（占位）
  - `*制度数据更新`（占位）
- **审查相关**
  - `绿建审查` → `Green-Building-Design-Review`
  - `*节能审查`（占位）
  - `*总说明审查`（占位）
  - `市系统下载PDF` → `review-drawing-downloader`
  - `*省系统下载PDF`（占位）
  - `*现行规范编号`（占位）
  - `*现行图集`（占位）
  - `规范图集自更新` → `specification-auto-update`
- **党群文章**
  - `*宣传稿撰写`（占位）
  - `*党建文章`（占位）
  - `公文排版` → `document-format`
  - `*公众号一键发布`（占位）
  - `*文章润色`（占位）
  - `*文本扩写`（占位）
  - `*文本缩写`（占位）
  - `*文本改写`（占位）
  - `*文本续写`（占位）
  - `*文章总结`（占位）
  - `*公众号数据自更新`（占位）
- **经营投标**
  - `*商务标生成`（占位）
  - `*技术标生成`（占位）
  - `*合同审查`（占位）
  - `*刺探情报`（占位）
  - `*招标信息`（占位）
  - `*经营数据看板`（占位）
- **财务相关**
  - `*票据信息采集`（占位）
  - `*数据分析`（占位）
  - `*表格整理`（占位）
  - `*财务数据看板`（占位）
- **多模态**
  - `*文生图`（占位）
  - `*图生文`（占位）
  - `文本转语音` → `edge-tts`
  - `*语音转文本`（占位）
  - `*视频制作`（占位）
  - `*视频总结`（占位）
- **其它**
  - `梳理思路` → `thought-clarifier`
  - `个人决策顾问` → `personal-decision-advisor`
  - `*幻觉检测`（占位）
  - `*头脑风暴`（占位）
  - `文章去AI味`（占位）

### 3.2 新建组件 `packages/app/src/components/skills-panel/`

```
packages/app/src/components/skills-panel/
├── index.tsx                 # 导出 <SkillsPanel />
├── skills-panel.css          # 自定义样式（悬浮位置、抽屉动画、滚动条）
├── skills-panel-types.ts     # 类型定义（Skill / SkillGroup / SkillsData）
├── skills-panel-data.ts      # fetch JSON 工具 + Zod-like 简单校验
└── skills-panel-state.ts     # 持久化 expandedGroups
```

#### `skills-panel-types.ts`

```ts
export type Skill = {
  name: string
  developing: boolean
  skillId?: string
  tooltip: string
  keyword: string
  case: string
  prompt: string
}
export type SkillGroup = {
  id: string
  name: string
  skills: Skill[]
}
export type SkillsData = { version: number; groups: SkillGroup[] }
export type SkillsPanelState = { expanded: Record<string, boolean>; open: boolean }
```

#### `skills-panel-state.ts`

用 `persisted(Persist.global("skills-panel", ["skills-panel.v1"]), createStore<SkillsPanelState>({...}))` 持久化两组状态：抽屉 open/close、每个分组的 expanded。

#### `skills-panel-data.ts`

```ts
export async function loadSkillsData(): Promise<SkillsData> {
  const res = await fetch("/yejian/技能.json", { cache: "no-cache" })
  if (!res.ok) throw new Error(`加载技能 JSON 失败: HTTP ${res.status}`)
  return res.json() as Promise<SkillsData>
}
```

#### `index.tsx`（关键片段）

```tsx
export function SkillsPanel() {
  const [data] = createResource(loadSkillsData)
  const [state, setState] = persisted(
    Persist.global("skills-panel", ["skills-panel.v1"]),
    createStore<SkillsPanelState>({ expanded: {}, open: false }),
  )

  return (
    <div
      class="skills-panel-root"
      classList={{ "skills-panel-root--open": state.open }}
      onMouseLeave={() => state.open && setState("open", false)}
    >
      <button
        type="button"
        class="skills-panel-tab"
        aria-label="技能库"
        onMouseEnter={() => setState("open", true)}
      >
        <img src="/yejian/技能库.png" alt="技能库" />
      </button>

      <Show when={state.open && data()}>
        <div class="skills-panel-drawer" role="dialog" aria-label="技能库">
          <Show when={data()!.groups.length === 0}>
            <div class="skills-panel-empty">暂无技能分组</div>
          </Show>
          <For each={data()!.groups}>
            {(group) => <SkillGroupSection group={group} state={state} setState={setState} />}
          </For>
        </div>
      </Show>
    </div>
  )
}
```

抽屉默认 `max-height: calc(100vh - 96px); overflow-y: auto`，右内侧加细滚动条，hover 抽屉本身不会触发关闭（`onMouseLeave` 只绑在 root）。

`<SkillGroupSection>`：手风琴——点击切换 `state.expanded[group.id]`，但**不**影响其它分组（`Record<id, boolean>` 模型天然支持）。

#### `<SkillItem>`：点击时把预设 prompt 写入 prompt-input

```ts
function applyPromptToInput(text: string) {
  const el = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
  if (!el) return
  el.focus()
  // 清空
  el.innerHTML = ""
  // 插入文本
  const node = document.createTextNode(text)
  el.appendChild(node)
  // 把光标移到最后
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  // 触发 input 事件让 Solid 同步
  el.dispatchEvent(new InputEvent("input", { bubbles: true }))
}
```

然后 `setState("open", false)` 关掉悬浮框。

### 3.3 把 `<SkillsPanel />` 注入首页

修改 `packages/app/src/pages/home.tsx`：

```tsx
return (
  <>
    <Show when={settings.general.newLayoutDesigns()} fallback={<LegacyHome />}>
      <HomeDesign />
    </Show>
    <SkillsPanel />
  </>
)
```

因为 `<SkillsPanel />` 用 `position: fixed`，覆盖在最外层即可。新旧布局都生效。

### 3.4 修改 prompt-input 占位文字

`packages/app/src/components/prompt-input.tsx` 第 1338-1341 行：

```ts
const designPlaceholder = () => {
  if (store.mode === "shell") return placeholder()
  return "请输入交互内容。提示：/ 调用技能；ctrl+\\ 显示文件树"
}
```

注意：
- 第 1544 行的 `aria-label={designPlaceholder()}` 自动跟随
- 第 1571 行显示文本也跟随
- **不影响**旧版（`placeholder()` 由 `promptPlaceholder` 单独控制）—— 用户没要求改旧版，所以保持

### 3.5 CSS（`skills-panel.css`）

```css
.skills-panel-root {
  position: fixed;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
}
.skills-panel-tab {
  width: 36px;
  height: 64px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.skills-panel-tab img { width: 100%; height: 100%; object-fit: contain; }
.skills-panel-drawer {
  height: calc(100vh - 96px);
  max-height: 720px;
  width: 320px;
  background: var(--surface-raised-stronger-non-alpha, #1e1e1e);
  color: var(--text-base, #f0f0f0);
  box-shadow: 0 4px 24px rgba(0,0,0,.4);
  border-radius: 8px;
  margin-left: 8px;
  padding: 12px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.skills-group { margin-bottom: 8px; }
.skills-group-header {
  display: flex; align-items: center; gap: 4px;
  cursor: pointer; user-select: none; padding: 4px 6px;
  font-weight: 530;
}
.skills-group-items { padding-left: 12px; }
.skills-item {
  display: flex; align-items: center; padding: 4px 6px;
  cursor: pointer; border-radius: 4px;
}
.skills-item:hover { background: rgba(255,255,255,.06); }
.skills-item--developing { color: #888; cursor: not-allowed; }
.skills-tooltip-title { font-weight: 600; margin-bottom: 4px; }
.skills-tooltip-row { font-size: 12px; line-height: 1.5; }
.skills-tooltip-key { color: #8ab4ff; }
```

### 3.6 不改动的部分

- **后端 `packages/opencode`**：本任务不修改
- **桌面端 `packages/desktop`**：本任务不修改
- **i18n**：技能分组名称、Tooltip 文案都在 JSON 里走，不用 i18n 维护
- **旧版 placeholder (`promptPlaceholder`)**：用户没要求改

## 4. 关键假设与决策

1. **悬浮框覆盖范围**：用户说"贴页面的最左侧、垂直方向中间"，所以 `position: fixed; left: 0; top: 50%`（不随滚动变化）
2. **抽屉位置**：向右拉（用户说"抽屉拉开"）→ `margin-left: 8px`
3. **同时支持新旧布局**：放在 `<Home>` 外层而不是分支内，统一对新旧布局都生效
4. **JSON 路径**：用户已选 `public/yejian/技能.json`（中文文件名，Vite 支持）
5. **状态持久化 key**：`"skills-panel"`，存放在 `opencode.global.dat`
6. **写入 prompt-input 的策略**：清空 + 插入文本节点 + 派发 `input` 事件；不直接动 Solid 内部 store（保持简单、避免破坏 prompt-input 的响应式状态）
7. **占位灰**：CSS class `skills-item--developing`，鼠标悬浮仍显示 Tooltip（Tooltip 提示"功能开发中"）；点击无效（直接 return）
8. **滚动条**：抽屉外层用 `overflow-y: auto` + `scrollbar-width: thin`，避免内容超出可视区域
9. **fetch 失败**：JSON 加载失败时不显示抽屉（`<Show when={state.open && data()}>` 短路），不弹错误 toast
10. **不引入新依赖**

## 5. 验证步骤

1. **资源可达**：
   - `bun run --filter @opencode-ai/app dev`
   - 浏览器打开 `/`，devtools Network → 200 `/yejian/技能库.png` 和 `/yejian/技能.json`
2. **视觉**：
   - 左侧边缘出现 `技能库.png`（垂直居中）
   - 鼠标 hover → 抽屉向右滑出
   - 鼠标离开 root → 抽屉收起
3. **手风琴**：
   - 展开 日常办公，再展开 审查相关，再展开 党群文章 → 三个分组同时展开
   - 折叠 审查相关 → 其它两个保持展开
4. **持久化**：
   - 展开/折叠几个分组后刷新页面 → 状态保持
5. **Tooltip**：
   - 已开发技能（如 "PDF转MD"）显示完整 tooltip（名称 + 详情 + 关键词 + 案例）
   - 占位技能（如 "*生成PPT"）显示 "功能开发中"
6. **点击**：
   - 点击 "PDF转MD" → prompt-input 出现预设文字、悬浮框关闭
   - 点击 "*生成PPT" → 不出现文字（占位）、悬浮框仍关闭（用户说"开发中"——按主流约定，仍关闭抽屉以避免误操作）
7. **滚动**：
   - 抽屉高度限制 + 内部内容超出时，右侧出现滚动条，可滚动
8. **占位文字**：
   - 新设计下 prompt-input 空状态显示 "请输入交互内容。提示：/ 调用技能；ctrl+\ 显示文件树"
9. **typecheck**：`bun run --filter @opencode-ai/app typecheck` 必须通过
10. **多入口覆盖**：
    - `LegacyHome`（关掉 `newLayoutDesigns`）下悬浮框仍显示
    - 切到 `HomeDesign` 也显示

## 6. 涉及的文件

- 新建：
  - `packages/app/public/yejian/技能库.png`（用户提供的源文件）
  - `packages/app/public/yejian/技能.json`
  - `packages/app/src/components/skills-panel/index.tsx`
  - `packages/app/src/components/skills-panel/skills-panel.css`
  - `packages/app/src/components/skills-panel/skills-panel-types.ts`
  - `packages/app/src/components/skills-panel/skills-panel-data.ts`
  - `packages/app/src/components/skills-panel/skills-panel-state.ts`
- 修改：
  - `packages/app/src/pages/home.tsx`（注入 `<SkillsPanel />`）
  - `packages/app/src/components/prompt-input.tsx`（改 `designPlaceholder` 的字符串）
- 不改：
  - 后端 `packages/opencode/**`
  - 桌面端 `packages/desktop/**`
  - i18n 文件
  - 路由表
