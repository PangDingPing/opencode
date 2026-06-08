import { createSignal, For, Show, type JSX } from "solid-js"
import skillsConfig from "@yejian/config/skills.json"
import { useSkillPrompt } from "@yejian/context/SkillPrompt"
import { SkillTooltip } from "@yejian/components/SkillTooltip"

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

type SkillTooltipData = {
  detail?: string
  keywords?: string[]
  example?: string
}

type SkillItem = {
  id: string
  name: string
  placeholder?: boolean
  invokeName?: string
  prompt?: string
  tooltip?: SkillTooltipData
}

type GroupItem = {
  id: string
  name: string
  skills: SkillItem[]
}

const groups: GroupItem[] = (skillsConfig as { groups: GroupItem[] }).groups

// ---------------------------------------------------------------------------
// 行内样式工厂
// ---------------------------------------------------------------------------

const navItemStyle = (active: boolean): JSX.CSSProperties => ({
  "text-align": "left",
  padding: "6px 8px",
  border: "none",
  background: active ? "#334155" : "transparent",
  color: "#e2e8f0",
  cursor: "pointer",
  "border-radius": "4px",
  width: "100%",
  "font-family": "system-ui, sans-serif",
  "font-size": "13px",
})

const groupHeaderStyle = (): JSX.CSSProperties => ({
  "text-align": "left",
  padding: "4px 8px 4px 16px",
  border: "none",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  "border-radius": "4px",
  width: "100%",
  "font-family": "system-ui, sans-serif",
  "font-size": "12px",
})

const skillItemStyle = (placeholder?: boolean): JSX.CSSProperties => ({
  "text-align": "left",
  padding: "3px 8px 3px 28px",
  border: "none",
  background: "transparent",
  color: placeholder ? "#64748b" : "#e2e8f0",
  cursor: placeholder ? "not-allowed" : "pointer",
  "border-radius": "4px",
  width: "100%",
  "font-family": "system-ui, sans-serif",
  "font-size": "12px",
})

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 左侧面板一：导航 + 技能 + 设置。
 * 用途：冶建工作台最左侧纵向面板，包含：
 *       - 顶栏"通用会话"与"技能会话"模式切换
 *       - 可展开的手风琴技能分组（7 组，46 项技能）
 *       - 底部"设置"入口
 *       - 技能 hover 300ms 后显示悬浮提示浮层
 *       - 可用技能点击后通过 SkillPrompt 上下文注入预设提示词
 * 入参：onOpenSettings 父级提供的设置面板打开回调
 * 返回：左侧面板 JSX
 */
export function PanelOne(props: { onOpenSettings: () => void }): JSX.Element {
  const { setPrompt } = useSkillPrompt()

  // ---------- 模式 ----------
  const [mode, setMode] = createSignal<"general" | "skill">("skill")

  // ---------- 手风琴 ----------
  const [allExpanded, setAllExpanded] = createSignal(true)
  const [groupOverrides, setGroupOverrides] = createSignal<Record<string, boolean>>({})

  const isGroupOpen = (id: string): boolean => {
    const ov = groupOverrides()
    return id in ov ? ov[id] : allExpanded()
  }

  const toggleAllGroups = (): void => {
    const next = !allExpanded()
    setAllExpanded(next)
    setGroupOverrides({})
  }

  const toggleGroup = (id: string): void => {
    setGroupOverrides((prev) => ({
      ...prev,
      [id]: !isGroupOpen(id),
    }))
  }

  const handleModeGeneral = (): void => {
    setMode("general")
  }

  const handleModeSkill = (): void => {
    if (mode() === "general") {
      setMode("skill")
      setAllExpanded(true)
      setGroupOverrides({})
      return
    }
    toggleAllGroups()
  }

  // ---------- 悬浮 ----------
  const [hover, setHover] = createSignal<{
    skill: SkillItem
    x: number
    y: number
  } | null>(null)

  const [pendingTimer, setPendingTimer] = createSignal<number | null>(null)

  const onHoverEnter = (s: SkillItem, e: MouseEvent): void => {
    const t = pendingTimer()
    if (t !== null) clearTimeout(t)
    const id = window.setTimeout(() => {
      setHover({ skill: s, x: e.clientX, y: e.clientY })
    }, 300)
    setPendingTimer(id)
  }

  const onHoverMove = (e: MouseEvent): void => {
    const h = hover()
    if (h) setHover({ ...h, x: e.clientX, y: e.clientY })
  }

  const onHoverLeave = (): void => {
    const t = pendingTimer()
    if (t !== null) clearTimeout(t)
    setPendingTimer(null)
    setHover(null)
  }

  const onSkillClick = (s: SkillItem): void => {
    if (s.placeholder || !s.prompt) return
    setPrompt(s.prompt)
  }

  // ---------- 渲染 ----------
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "#0f172a",
        padding: "8px",
        gap: "2px",
      }}
    >
      {/* ---------- 顶栏：通用会话 / 技能会话 ---------- */}
      <button style={navItemStyle(mode() === "general")} onClick={handleModeGeneral}>
        💬 通用会话
      </button>
      <button style={navItemStyle(mode() === "skill")} onClick={handleModeSkill}>
        🛠 技能会话 <span style={{ "font-size": "10px" }}>{allExpanded() ? "▼" : "▶"}</span>
      </button>

      {/* ---------- 技能分组列表 ---------- */}
      <Show when={mode() === "skill"}>
        <div style={{ overflow: "auto", flex: "1 1 0" }}>
          <For each={groups}>
            {(g) => (
              <div>
                <button style={groupHeaderStyle()} onClick={[toggleGroup, g.id]}>
                  {isGroupOpen(g.id) ? "▼" : "▶"} {g.name}
                </button>
                <Show when={isGroupOpen(g.id)}>
                  <For each={g.skills}>
                    {(s) => (
                      <button
                        style={skillItemStyle(s.placeholder)}
                        disabled={s.placeholder}
                        onClick={[onSkillClick, s]}
                        onMouseEnter={[onHoverEnter, s]}
                        onMouseMove={onHoverMove}
                        onMouseLeave={onHoverLeave}
                      >
                        {s.name}
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ---------- 底部：设置 ---------- */}
      <div style={{ "margin-top": "auto" }}>
        <button style={navItemStyle(false)} onClick={props.onOpenSettings}>
          ⚙ 设置
        </button>
      </div>

      {/* ---------- 悬浮提示 ---------- */}
      <SkillTooltip
        show={hover() !== null}
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