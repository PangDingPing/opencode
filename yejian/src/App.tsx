import { Navigate, Route, Router } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import {
  AppBaseProviders,
  AppShellProviders,
  ConnectionGate,
  GlobalProvider,
  type Platform,
  PlatformProvider,
  ServerConnection,
  ServerProvider,
  ServerSDKProvider,
  ServerSyncProvider,
  TabsProvider,
} from "@opencode-ai/app"
import SessionPage from "@yejian/pages/SessionPage"

/**
 * 构造 web 平台的 Platform 实现。
 * 用途：为 PlatformProvider 提供必需的平台能力（导航、通知、打开链接等）。
 * 入参：无
 * 返回：Platform 对象（platform: "web"）
 */
function buildWebPlatform(): Platform {
  return {
    platform: "web",
    openLink: (url) => {
      window.open(url, "_blank")
    },
    back: () => {
      window.history.back()
    },
    forward: () => {
      window.history.forward()
    },
    restart: async () => {
      window.location.reload()
    },
    notify: async () => {
      // 冶建工作台暂不需要桌面通知，保持空实现
    },
  }
}

/**
 * 解析默认 opencode-server 地址。
 * 用途：dev 模式下从 vite 环境变量读取，生产模式下使用同源地址（nginx 反代到 opencode-server）。
 * 入参：无
 * 返回：服务端 URL 字符串
 */
function resolveServerUrl(): string {
  if (import.meta.env.DEV) {
    const host = (import.meta.env.VITE_OPENCODE_SERVER_HOST as string | undefined) ?? "localhost"
    const port = (import.meta.env.VITE_OPENCODE_SERVER_PORT as string | undefined) ?? "4096"
    return `http://${host}:${port}`
  }
  return window.location.origin
}

/**
 * 构造默认的 opencode HTTP 服务连接对象。
 * 用途：作为 ServerProvider 的初始 servers 项与 defaultServer 键。
 * 入参：无
 * 返回：{ key, server } 元组
 */
function buildDefaultServer(): { key: ServerConnection.Key; server: ServerConnection.Http } {
  const server: ServerConnection.Http = {
    type: "http",
    http: { url: resolveServerUrl() },
  }
  return { key: ServerConnection.key(server), server }
}

/**
 * 顶层应用组件。
 * 用途：按 opencode AppInterface 的内部结构手动拼装完整 Provider 链
 *       （PlatformProvider → AppBaseProviders → ServerProvider → GlobalProvider
 *        → ConnectionGate → TabsProvider → ServerSDKProvider → ServerSyncProvider
 *        → AppShellProviders → Router），以便 useSDK/useSync/useFile 在
 *       SessionPage 内可用；并在根路径自动跳转到 /yejian 占位路由。
 * 入参：无
 * 返回：完整 SolidJS 应用根
 */
export default function App() {
  const platform = buildWebPlatform()
  const { key: defaultServerKey, server: defaultServer } = buildDefaultServer()

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Title>广东冶建施工图审查中心 AI 工作台</Title>
        <ServerProvider
          defaultServer={defaultServerKey}
          canonicalLocalServer={defaultServerKey}
          servers={[defaultServer]}
        >
          <GlobalProvider>
            {/* TODO(Task 12): docker 部署完成后去掉 disableHealthCheck，让前端在后端不可用时显示 502 兜底 */}
            <ConnectionGate disableHealthCheck>
              <TabsProvider>
                <ServerSDKProvider>
                  <ServerSyncProvider>
                    <AppShellProviders>
                      <Router>
                        <Route path="/" component={() => <Navigate href="/yejian" />} />
                        <Route path="/yejian" component={SessionPage} />
                        <Route path="/yejian/:dir" component={SessionPage} />
                        <Route path="/yejian/:dir/session/:id?" component={SessionPage} />
                      </Router>
                    </AppShellProviders>
                  </ServerSyncProvider>
                </ServerSDKProvider>
              </TabsProvider>
            </ConnectionGate>
          </GlobalProvider>
        </ServerProvider>
      </AppBaseProviders>
    </PlatformProvider>
  )
}
