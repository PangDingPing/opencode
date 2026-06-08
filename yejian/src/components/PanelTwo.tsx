import { createEffect, createMemo, createSignal, For, on, Show, Suspense, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useSDK } from "@opencode-ai/app"
import { useCurrentUser } from "@yejian/hooks/useCurrentUser"
import { useProjects, type Project } from "@yejian/hooks/useProjects"
import { useProjectSessions, type SessionInfo } from "@yejian/hooks/useProjectSessions"
import { maskPhone } from "@yejian/utils/phoneMask"
import { relativeTime, absoluteTime } from "@yejian/utils/relativeTime"

// ---------------------------------------------------------------------------
// 行内样式
// ---------------------------------------------------------------------------

const containerStyle = (): JSX.CSSProperties => ({
  display: "flex",
  "flex-direction": "column",
  height: "100%",
  background: "#0b1320",
  color: "#e2e8f0",
  "font-family": "system-ui, sans-serif",
  "font-size": "13px",
})

const headerStyle = (): JSX.CSSProperties => ({
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "8px 10px",
  "border-bottom": "1px solid #1e293b",
  "flex-shrink": 0,
})

const headerTitleStyle = (): JSX.CSSProperties => ({
  "font-size": "13px",
  "font-weight": 600,
  color: "#cbd5e1",
})

const iconBtnStyle = (): JSX.CSSProperties => ({
  background: "transparent",
  border: "none",
  color: "#94a3b8",
  cursor: "pointer",
  padding: "2px 6px",
  "font-size": "12px",
  "border-radius": "3px",
})

const emptyStyle = (): JSX.CSSProperties => ({
  padding: "16px 12px",
  color: "#64748b",
  "font-size": "12px",
  "text-align": "center",
})

const projectRowStyle = (): JSX.CSSProperties => ({
  display: "flex",
  "align-items": "center",
  padding: "6px 10px",
  cursor: "pointer",
  "border-radius": "3px",
  "user-select": "none",
})

const sessionRowStyle = (): JSX.CSSProperties => ({
  display: "flex",
  "flex-direction": "column",
  padding: "4px 10px 4px 28px",
  cursor: "pointer",
  "border-radius": "3px",
  "user-select": "none",
})

const sessionTitleStyle = (): JSX.CSSProperties => ({
  color: "#e2e8f0",
  "font-size": "12px",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
})

const sessionTimeStyle = (): JSX.CSSProperties => ({
  color: "#64748b",
  "font-size": "10px",
})

const newSessionBtnStyle = (): JSX.CSSProperties => ({
  "text-align": "left",
  padding: "4px 10px 4px 28px",
  border: "none",
  background: "transparent",
  color: "#60a5fa",
  cursor: "pointer",
  "border-radius": "3px",
  width: "100%",
  "font-family": "system-ui, sans-serif",
  "font-size": "12px",
})

// ---------------------------------------------------------------------------
// 子组件：单个项目的展开内容
// ---------------------------------------------------------------------------

/**
 * 单个项目节点：含 session 列表 + "新建会话"按钮。
 * 用途：拆出来以便每个项目独立持有 useProjectSessions 资源（解决 createResource
 *       与 For 内联无法共享 hook 实例的问题）。
 * 入参：project — 项目对象；expanded — 是否展开；onNavigateSession — 跳转回调；
 *       onCreateSession — 新建会话回调；refreshCount — 外部刷新计数器，
 *       变更时触发已展开项目的 session 列表重拉
 * 返回：项目行 + 展开内容 JSX
 */
function ProjectNode(props: {
  project: Project
  expanded: boolean
  refreshCount: number
  onToggle: () => void
  onNavigateSession: (project: Project, session: SessionInfo) => void
  onCreateSession: (project: Project) => void
}): JSX.Element {
  // dir Accessor：未展开返回 undefined，从而使 createResource 跳过加载
  const dirAccessor = createMemo<string | undefined>(() => (props.expanded ? props.project.path : undefined))
  const [sessions, { refetch: refetchSessions }] = useProjectSessions(dirAccessor)

  // refreshCount 变化时重拉 session 列表（仅当节点已展开才会有实际数据）
  createEffect(
    on(
      () => props.refreshCount,
      () => {
        if (props.expanded) refetchSessions()
      },
      { defer: true },
    ),
  )

  return (
    <div>
      <div style={projectRowStyle()} onClick={props.onToggle} title={props.project.phone}>
        <span style={{ "margin-right": "4px", color: "#94a3b8", "font-size": "10px" }}>
          {props.expanded ? "▼" : "▶"}
        </span>
        <span>📁 {maskPhone(props.project.phone)}</span>
      </div>
      <Show when={props.expanded}>
        <Suspense fallback={<div style={emptyStyle()}>加载中…</div>}>
          <For each={sessions() ?? []} fallback={<div style={emptyStyle()}>暂无会话</div>}>
            {(s) => (
              <div
                style={sessionRowStyle()}
                title={absoluteTime(s.updatedAt)}
                onClick={() => props.onNavigateSession(props.project, s)}
              >
                <span style={sessionTitleStyle()}>{s.title}</span>
                <span style={sessionTimeStyle()}>{relativeTime(s.updatedAt)}</span>
              </div>
            )}
          </For>
          <button style={newSessionBtnStyle()} onClick={() => props.onCreateSession(props.project)}>
            + 新建会话
          </button>
        </Suspense>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * 左侧面板二：项目-Session 树。
 * 用途：列出 /workspace 下当前手机号匹配的项目目录（UI 层隔离），
 *       展开后显示该项目的 session 列表（含相对时间）；提供刷新、折叠、
 *       新建会话操作。点击 session 跳转 /yejian/<base64(项目路径)>/session/<id>。
 * 入参：onCollapse — 父级折叠面板回调
 * 返回：面板 JSX
 */
export function PanelTwo(props: { onCollapse: () => void }): JSX.Element {
  const navigate = useNavigate()
  const sdk = useSDK()
  const currentUser = useCurrentUser()
  const [projects, projectsApi] = useProjects()
  const [expandedPath, setExpandedPath] = createSignal<string | null>(null)
  const [refreshCount, setRefreshCount] = createSignal(0)

  /** 重拉项目列表 + 已展开项目的 session 列表 */
  const refreshAll = (): void => {
    projectsApi.refetch()
    setRefreshCount((c) => c + 1)
  }

  const toggleProject = (path: string): void => {
    setExpandedPath((prev) => (prev === path ? null : path))
  }

  const navigateToSession = (project: Project, session: SessionInfo): void => {
    navigate(`/yejian/${btoa(project.path)}/session/${session.id}`)
  }

  const createSession = async (project: Project): Promise<void> => {
    // 在指定项目目录下创建新 session，再跳转至该 session 路由
    const res = await sdk.client.session.create({
      directory: project.path,
      title: "新会话",
    })
    const session = res.data
    if (!session?.id) {
      window.alert("新建会话失败：服务端未返回 session id")
      return
    }
    navigate(`/yejian/${btoa(project.path)}/session/${session.id}`)
  }

  return (
    <div style={containerStyle()}>
      {/* ---------- 顶栏 ---------- */}
      <div style={headerStyle()}>
        <span style={headerTitleStyle()}>项目列表</span>
        <span>
          <button style={iconBtnStyle()} title="刷新" onClick={refreshAll}>
            ⟳
          </button>
          <button style={iconBtnStyle()} title="折叠" onClick={props.onCollapse}>
            ◀
          </button>
        </span>
      </div>

      {/* ---------- 内容区 ---------- */}
      <div style={{ flex: "1 1 0", overflow: "auto", padding: "4px 0" }}>
        <Show
          when={currentUser()}
          fallback={<div style={emptyStyle()}>未登录</div>}
        >
          <Suspense fallback={<div style={emptyStyle()}>加载中…</div>}>
            <Show
              when={(projects() ?? []).length > 0}
              fallback={<div style={emptyStyle()}>未找到您的项目目录，请联系管理员</div>}
            >
              <For each={projects() ?? []}>
                {(p) => (
                  <ProjectNode
                    project={p}
                    expanded={expandedPath() === p.path}
                    refreshCount={refreshCount()}
                    onToggle={() => toggleProject(p.path)}
                    onNavigateSession={navigateToSession}
                    onCreateSession={(proj) => {
                      void createSession(proj)
                    }}
                  />
                )}
              </For>
            </Show>
          </Suspense>
        </Show>
      </div>
    </div>
  )
}
