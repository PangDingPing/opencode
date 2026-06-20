import { Tooltip } from "@opencode-ai/ui/tooltip"
import { For, Show, createResource, type JSX } from "solid-js"
import "./skills-panel.css"
import { loadSkillsData } from "./skills-panel-data"
import { createSkillsPanelState } from "./skills-panel-state"
import type { Skill, SkillGroup, SkillsPanelState } from "./skills-panel-types"

const SKILLS_PANEL_TAB_IMAGE = "/yejian/skills-panel-icon.png"

function applyPromptToInput(text: string) {
  if (typeof document === "undefined") return
  const el = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
  if (!el) return
  el.focus()
  // 清空
  el.innerHTML = ""
  // 插入文本节点
  const node = document.createTextNode(text)
  el.appendChild(node)
  // 把光标移到末尾
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  // 触发 input 事件让 Solid 同步内部状态
  el.dispatchEvent(new InputEvent("input", { bubbles: true }))
}

function openSkillUrl(url: string) {
  if (typeof window === "undefined") return
  window.open(url, "_blank", "noopener,noreferrer")
}

function runSkillAction(skill: Skill) {
  if (skill.action === "url" && skill.url) {
    openSkillUrl(skill.url)
    return
  }
  applyPromptToInput(skill.prompt)
}

function SkillTooltip(props: { skill: Skill }) {
  return (
    <div>
      <div class="skills-tooltip-title">{props.skill.name}</div>
      <div class="skills-tooltip-row">
        <span class="skills-tooltip-label">说明：</span>
        {props.skill.tooltip}
      </div>
      <Show when={props.skill.keyword}>
        <div class="skills-tooltip-row">
          <span class="skills-tooltip-label">调用关键词：</span>
          <span class="skills-tooltip-key">{props.skill.keyword}</span>
        </div>
      </Show>
      <Show when={props.skill.case}>
        <div class="skills-tooltip-row">
          <span class="skills-tooltip-label">使用案例：</span>
          <Show
            when={Array.isArray(props.skill.case)}
            fallback={<span>{props.skill.case as string}</span>}
          >
            <ul class="skills-tooltip-case-list">
              <For each={props.skill.case as string[]}>{(c) => <li>{c}</li>}</For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function SkillItem(props: {
  skill: Skill
  onPick: (skill: Skill) => void
}): JSX.Element {
  const handleClick = () => {
    if (props.skill.developing) return
    props.onPick(props.skill)
  }
  return (
    <Tooltip
      value={<SkillTooltip skill={props.skill} />}
      placement="right"
      contentClass="skills-tooltip-content"
    >
      <button
        type="button"
        classList={{
          "skills-item": true,
          "skills-item--developing": props.skill.developing,
        }}
        onClick={handleClick}
        aria-label={props.skill.name}
        disabled={props.skill.developing}
      >
        {props.skill.name}
      </button>
    </Tooltip>
  )
}

function SkillGroupSection(props: {
  group: SkillGroup
  state: SkillsPanelState
  setState: (...args: any[]) => void
  onPick: (skill: Skill) => void
}) {
  const isExpanded = () => !!props.state.expanded[props.group.id]
  const toggle = () => {
    props.setState("expanded", props.group.id, !isExpanded())
  }
  return (
    <div class="skills-group">
      <div
        class="skills-group-header"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggle()
          }
        }}
        aria-expanded={isExpanded()}
      >
        <span class="skills-group-arrow">{isExpanded() ? "▼" : "▶"}</span>
        <span>{props.group.name}</span>
        <span style={{ "margin-left": "auto", "font-size": "11px", color: "var(--text-faint, #888)" }}>
          {props.group.skills.length}
        </span>
      </div>
      <Show when={isExpanded()}>
        <div class="skills-group-items">
          <For each={props.group.skills}>
            {(skill) => <SkillItem skill={skill} onPick={props.onPick} />}
          </For>
        </div>
      </Show>
    </div>
  )
}

export function SkillsPanel() {
  const [data] = createResource(loadSkillsData)
  const { state, setState } = createSkillsPanelState()

  const open = () => {
    setState("open", true)
  }
  const close = () => {
    setState("open", false)
  }
  const handlePick = (skill: Skill) => {
    runSkillAction(skill)
    close()
  }

  return (
    <div
      class="skills-panel-root"
      data-component="skills-panel"
      onMouseLeave={(e) => {
        // 仅当鼠标真正离开 root（不在 drawer / tab 内部）时关闭
        const related = e.relatedTarget as Node | null
        const root = e.currentTarget as HTMLDivElement
        if (related && root.contains(related)) return
        if (state.open) close()
      }}
    >
      <button
        type="button"
        class="skills-panel-tab"
        aria-label="技能库"
        onMouseEnter={open}
        onFocus={open}
      >
        <img src={SKILLS_PANEL_TAB_IMAGE} alt="技能库" draggable={false} />
      </button>

      <Show when={state.open}>
        <div
          class="skills-panel-drawer"
          role="dialog"
          aria-label="技能库"
          onMouseEnter={open}
        >
          <Show
            when={data()}
            fallback={
              <Show
                when={data.error}
                fallback={<div class="skills-panel-loading">技能加载中…</div>}
              >
                <div class="skills-panel-empty">技能加载失败</div>
              </Show>
            }
          >
            {(loaded) => (
              <Show
                when={loaded().groups.length > 0}
                fallback={<div class="skills-panel-empty">暂无技能分组</div>}
              >
                <For each={loaded().groups}>
                  {(group) => (
                    <SkillGroupSection
                      group={group}
                      state={state}
                      setState={setState}
                      onPick={handlePick}
                    />
                  )}
                </For>
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

export default SkillsPanel
