import { Show, createEffect, createMemo, createResource, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useSearchParams } from "@solidjs/router"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { NewSessionDesignView } from "@/components/session"
import FileTree from "@/components/file-tree"
import { PromptInput } from "@/components/prompt-input"
import { useSettingsCommand } from "@/components/settings-dialog"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  createPromptProjectController,
} from "@/components/prompt-project-selector"
import { useComments } from "@/context/comments"
import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { createPromptInputController, createPromptProjectControls } from "@/pages/session/composer"
import { shouldShowFileTree } from "@/pages/session/helpers"
import { useSessionKey } from "@/pages/session/session-layout"
import { useComposerCommands } from "@/pages/session/use-composer-commands"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"

const showWorkspaceBar = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"

/**
 * The `/new-session` draft page. Renders the prompt composer for a brand-new session
 * with an optional file tree sidebar — no terminal, review pane, or message timeline.
 * Submitting promotes the draft into a real session (see prompt-input/submit).
 */
export default function NewSessionPage() {
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const comments = useComments()
  const language = useLanguage()
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const route = useSessionKey()
  const [searchParams, setSearchParams] = useSearchParams<{ draftId?: string; prompt?: string }>()

  useComposerCommands()
  useSettingsCommand()

  let inputRef: HTMLDivElement | undefined

  const inputController = createPromptInputController({
    sessionKey: route.sessionKey,
    sessionID: () => route.params.id,
    queryOptions: serverSync().queryOptions,
  })
  const projectControls = createPromptProjectControls()
  const projectController = createPromptProjectController({
    controls: projectControls,
    onDone: () => inputRef?.focus(),
  })

  const [store, setStore] = createStore<{ worktree?: string }>({})

  const newSessionWorktree = createMemo(() => {
    if (store.worktree) return store.worktree
    const project = sync().project
    if (project && sdk().directory !== project.worktree) return sdk().directory
    return "main"
  })
  const projectRoot = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const localBranch = createMemo(() => serverSync().child(projectRoot())[0].vcs?.branch)
  const selectedBranch = createMemo(() => {
    const worktree = newSessionWorktree()
    if (worktree === "main" || worktree === "create") return localBranch()
    return serverSync().child(worktree)[0].vcs?.branch ?? localBranch()
  })

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  createEffect(() => {
    if (!prompt.ready()) return
    requestAnimationFrame(() => inputRef?.focus())
  })
  const ready = Promise.resolve()
  const [promptReady] = createResource(
    () => prompt.ready.promise ?? ready,
    (promise) => promise.then(() => true),
  )

  // 文件树侧边栏：桌面端 + 设置可见 + layout 打开 时显示
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const fileTreeOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: settings.visibility.fileTree(),
        opened: layout.fileTree.opened(),
      }),
  )

  // 加载文件树根目录，directory 变化时刷新
  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk().directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync().status === "loading") return

    layout.fileTree.tab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  return (
    <div class="relative size-full overflow-hidden flex flex-row">
      <Show when={fileTreeOpen()}>
        <aside
          class="relative h-full shrink-0 overflow-hidden bg-background-base border-r border-border-weaker-base"
          style={{ width: `${layout.fileTree.width()}px` }}
        >
          <div class="h-full flex flex-col overflow-hidden">
            <FileTree path="" class="pt-3 px-3 flex-1 min-h-0 overflow-auto" onFileClick={(node) => file.load(node.path)} />
          </div>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={layout.fileTree.width()}
            min={200}
            max={480}
            onResize={(width) => layout.fileTree.resize(width)}
          />
        </aside>
      </Show>
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <div class="@container relative flex flex-col min-h-0 h-full flex-1">
          <div class="flex-1 min-h-0 overflow-hidden rounded-[10px]">
            <NewSessionDesignView>
              <div class={NEW_SESSION_CONTENT_WIDTH}>
                <Show
                  when={prompt.ready() || promptReady()}
                  fallback={
                    <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak pointer-events-none">
                      {language.t("prompt.loading")}
                    </div>
                  }
                >
                  <div class="flex flex-col" classList={{ "gap-8": showWorkspaceBar, "gap-3": !showWorkspaceBar }}>
                    <PromptInput
                      controls={inputController()}
                      variant="new-session"
                      ref={(el) => {
                        inputRef = el
                      }}
                      newSessionWorktree={newSessionWorktree()}
                      onNewSessionWorktreeReset={() => setStore("worktree", undefined)}
                      onSubmit={() => comments.clear()}
                      toolbar={
                        <Show when={!projectController.selected()}>
                          <PromptProjectAddButton controller={projectController} />
                        </Show>
                      }
                    />
                    <Show when={projectController.selected()}>
                      <div
                        class="flex min-h-7 min-w-0 items-center gap-0 text-v2-text-text-faint"
                        classList={{
                          "flex-col justify-center sm:flex-row": showWorkspaceBar,
                          "justify-start": !showWorkspaceBar,
                        }}
                      >
                        <PromptProjectSelector
                          controller={projectController}
                          placement={showWorkspaceBar ? "bottom" : "bottom-start"}
                        />
                        <Show when={showWorkspaceBar}>
                          <PromptWorkspaceSelector
                            value={newSessionWorktree()}
                            projectRoot={projectRoot()}
                            workspaces={sync().project?.sandboxes ?? []}
                            branch={selectedBranch()}
                            onChange={(value) =>
                              setStore(
                                "worktree",
                                value === "main" && sync().project?.worktree !== sdk().directory
                                  ? sync().project?.worktree
                                  : value,
                              )
                            }
                            onDone={() => inputRef?.focus()}
                          />
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </NewSessionDesignView>
          </div>
        </div>
      </div>
    </div>
  )
}
