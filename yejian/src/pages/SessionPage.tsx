import { Show, createEffect, createMemo, createSignal, JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import {
  MessageTimeline,
  SessionComposerRegion,
  createSessionComposerState,
  SessionReviewTab,
  TerminalPanel,
  SDKProvider,
  SessionProviders,
  useSync,
  usePrompt,
} from "@opencode-ai/app"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { PanelOne } from "@yejian/components/PanelOne"
import { PanelTwo } from "@yejian/components/PanelTwo"
import { ErrorBoundary } from "@yejian/components/ErrorBoundary"
import { SkillPromptProvider, useSkillPrompt } from "@yejian/context/SkillPrompt"
import { useUiPreference } from "@yejian/hooks/useUiPreference"
import { WORKSPACE_PATH } from "@yejian/config/app"

/**
 * Session 页面主组件（路由入口）。
 * 用途：包错误边界 + SkillPromptProvider，再 mount 实际四列布局。
 * 入参：路由 :dir / :id（base64 dir, sessionId）
 * 返回：完整工作台 JSX
 */
export default function SessionPage(): JSX.Element {
  return (
    <SkillPromptProvider>
      <ErrorBoundary>
        <SessionPageInner />
      </ErrorBoundary>
    </SkillPromptProvider>
  )
}

function SessionPageInner(): JSX.Element {
  const params = useParams()
  const dir = createMemo<string>(() => {
    const raw = params.dir
    if (!raw) return WORKSPACE_PATH
    try {
      return atob(raw)
    } catch {
      return WORKSPACE_PATH
    }
  })

  // 单 SDKProvider：dir 为解码后的项目路径（若无，则回退 WORKSPACE_PATH）。
  // PanelTwo 始终在 SDKProvider 内，但其 file.list 传递显式 WORKSPACE_PATH；
  // MessageTimeline / Composer / Review 使用 SDKProvider 的 directory 操作打开项目的文件。
  return (
    <SDKProvider directory={dir()}>
      <SessionProviders>
        <SessionLayout sessionId={params.id} />
      </SessionProviders>
    </SDKProvider>
  )
}

function SessionLayout(props: { sessionId?: string }): JSX.Element {
  const [prefs, setPrefs] = useUiPreference()
  const sync = useSync()
  const composer = createSessionComposerState()
  const prompt = usePrompt()
  const { pendingPrompt, consume } = useSkillPrompt()

  // 加载当前 session 的消息数据
  createEffect(() => {
    const id = props.sessionId
    if (!id) return
    void sync.session.sync(id)
  })

  // 桥接：PanelOne 写入的 prompt 流入 Composer 编辑器
  createEffect(() => {
    const t = pendingPrompt()
    if (!t) return
    prompt.set([{ type: "text", content: t, start: 0, end: t.length }], t.length)
    consume()
    queueMicrotask(() => {
      const editor = inputDiv()?.querySelector<HTMLDivElement>('[data-component="prompt-input"]')
      if (!editor) return
      editor.focus()
    })
  })

  const messages = createMemo(() => (props.sessionId ? (sync.data.message[props.sessionId] ?? []) : []))
  const userMessages = createMemo(() => messages().filter((m): m is UserMessage => m.role === "user"))

  const [scrollState] = createSignal({ overflow: false, bottom: true, jump: false })
  const [historyShift] = createSignal(false)

  const [reviewOpenPaths, setReviewOpenPaths] = createSignal<string[]>([])
  const scrollPositions: Record<string, { x: number; y: number }> = {}

  const makeView = () => ({
    scroll(tab: string) {
      return scrollPositions[tab]
    },
    setScroll(tab: string, pos: { x: number; y: number }) {
      scrollPositions[tab] = pos
    },
    todoCollapsed: {
      get: () => false,
      set: () => {},
    },
    terminal: {
      opened: () => prefs().terminalVisible,
      open: () => setPrefs((p) => ({ ...p, terminalVisible: true })),
      close: () => setPrefs((p) => ({ ...p, terminalVisible: false })),
      toggle: () => setPrefs((p) => ({ ...p, terminalVisible: !p.terminalVisible })),
    },
    reviewPanel: {
      opened: () => prefs().reviewVisible,
      open: () => setPrefs((p) => ({ ...p, reviewVisible: true })),
      close: () => setPrefs((p) => ({ ...p, reviewVisible: false })),
      toggle: () => setPrefs((p) => ({ ...p, reviewVisible: !p.reviewVisible })),
    },
    review: {
      open: reviewOpenPaths,
      setOpen: (paths: string[]) => setReviewOpenPaths(paths),
      openPath: () => {},
      closePath: () => {},
      togglePath: () => {},
    },
  })

  // 编辑器输入区 ref：用 Solid signal 持有，规避 `let`；effect 中 querySelector 聚焦实际 input
  const [inputDiv, setInputDiv] = createSignal<HTMLDivElement | undefined>()

  // 列模板：左一固定、左二可折叠（隐藏时 0px）、主区 1fr、审查面板可折叠（隐藏时 0px）
  const columnsTemplate = createMemo<string>(() => {
    const p = prefs()
    const col2 = p.panelTwoVisible ? `${p.panelTwoWidth}px` : "0px"
    const col4 = p.reviewVisible ? `${p.reviewWidth}px` : "0px"
    return `${p.panelOneWidth}px ${col2} 1fr ${col4}`
  })

  // 行模板：上部主区 1fr、底部终端 30vh（隐藏时单行）
  const rowsTemplate = createMemo<string>(() => (prefs().terminalVisible ? "1fr 30vh" : "1fr"))

  // §4.3 规范的两层 CSS Grid 布局：外层纵向分主区/终端，内层横向分四列
  return (
    <div
      style={{
        display: "grid",
        "grid-template-rows": rowsTemplate(),
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          "grid-template-columns": columnsTemplate(),
          overflow: "hidden",
          "min-height": 0,
        }}
      >
        {/* 左一：固定面板 */}
        <aside style={{ "min-width": 0, overflow: "hidden" }}>
          <PanelOne onOpenSettings={() => {}} />
        </aside>

        {/* 左二：文件浏览面板（可折叠） */}
        <Show when={prefs().panelTwoVisible} fallback={<div />}>
          <aside style={{ "min-width": 0, overflow: "hidden" }}>
            <PanelTwo onCollapse={() => setPrefs((p) => ({ ...p, panelTwoVisible: false }))} />
          </aside>
        </Show>

        {/* 主区：消息时间线 + 编辑器（内部用竖向 flex） */}
        <main
          style={{
            display: "flex",
            "flex-direction": "column",
            "min-width": 0,
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, "min-height": 0, overflow: "hidden" }}>
            <Show when={props.sessionId}>
              <MessageTimeline
                scroll={scrollState()}
                onResumeScroll={() => {}}
                setScrollRef={() => {}}
                onScheduleScrollState={() => {}}
                onAutoScrollHandleScroll={() => {}}
                onMarkScrollGesture={() => {}}
                hasScrollGesture={() => false}
                onUserScroll={() => {}}
                onHistoryScroll={() => {}}
                onAutoScrollInteraction={() => {}}
                shouldAnchorBottom={() => true}
                centered={true}
                setContentRef={() => {}}
                historyShift={historyShift()}
                userMessages={userMessages()}
                anchor={(id) => `message-${id}`}
              />
            </Show>
          </div>
          <SessionComposerRegion
            state={composer}
            ready={true}
            centered={true}
            placement="dock"
            inputRef={setInputDiv}
            newSessionWorktree="main"
            onNewSessionWorktreeReset={() => {}}
            onSubmit={() => {}}
            onResponseSubmit={() => {}}
            setPromptDockRef={() => {}}
          />
        </main>

        {/* 右侧：审查面板（可折叠） */}
        <Show when={prefs().reviewVisible} fallback={<div />}>
          <aside
            style={{
              "border-left": "1px solid #1e293b",
              "min-width": 0,
              overflow: "hidden",
            }}
          >
            <SessionReviewTab diffs={() => []} view={makeView} diffStyle="split" />
          </aside>
        </Show>
      </div>

      {/* 底部：终端面板（可折叠） */}
      <Show when={prefs().terminalVisible}>
        <div style={{ "border-top": "1px solid #1e293b", overflow: "hidden" }}>
          <TerminalPanel />
        </div>
      </Show>
    </div>
  )
}