export { AppBaseProviders, AppInterface } from "./app"
export { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_TYPES, filePickerFilters } from "./constants/file-picker"
export { useCommand } from "./context/command"
export { loadLocaleDict, normalizeLocale, type Locale } from "./context/language"
export { useWslServers } from "./wsl/context"
export { type DisplayBackend, type FatalRendererErrorLog, type Platform, PlatformProvider } from "./context/platform"
export { type UpdaterPlatform, type UpdaterState } from "./updater"
export {
  type WslDistroProbe,
  type WslInstalledDistro,
  type WslJob,
  type WslOnlineDistro,
  type WslOpencodeCheck,
  type WslRuntimeCheck,
  type WslServerConfig,
  type WslServerItem,
  type WslServerRuntime,
  type WslServersEvent,
  type WslServersPlatform,
  type WslServersState,
} from "./wsl/types"
export { ServerConnection } from "./context/server"
export { handleNotificationClick } from "./utils/notification-click"

// Session region components re-exported for the yejian custom app
export { MessageTimeline } from "./pages/session/message-timeline"
export {
  SessionComposerRegion,
  createSessionComposerState,
} from "./pages/session/composer"
export { SessionReviewTab } from "./pages/session/review-tab"
export { SessionSidePanel } from "./pages/session/session-side-panel"
export { TerminalPanel } from "./pages/session/terminal-panel"

// Context hooks re-exported for the yejian custom app
export { useSDK } from "./context/sdk"
export { useSync } from "./context/sync"
export { useFile } from "./context/file"
export { usePrompt } from "./context/prompt"

// Intermediate context providers required by external apps that wire their own routes
export { ServerProvider } from "./context/server"
export { ServerSDKProvider } from "./context/server-sdk"
export { ServerSyncProvider } from "./context/server-sync"
export { SDKProvider } from "./context/sdk"
export { FileProvider } from "./context/file"
export { TerminalProvider } from "./context/terminal"
export { PromptProvider } from "./context/prompt"
export { CommentsProvider } from "./context/comments"
export { GlobalProvider } from "./context/global"
export { TabsProvider } from "./context/tabs"

// Composite app-internal providers (re-exported from ./app):
// AppShellProviders bundles Settings/Permission/Layout/Notification/Models/Command/Highlights + Layout component;
// SessionProviders bundles Terminal/File/Prompt/Comments; ConnectionGate guards on server health.
export { AppShellProviders, SessionProviders, ConnectionGate, ServerKey } from "./app"
