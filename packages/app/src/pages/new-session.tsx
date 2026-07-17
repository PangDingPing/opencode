import { Show, createEffect, createMemo, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useSearchParams } from "@solidjs/router"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import FileTree from "@/components/file-tree"
import { NewSessionDesignView } from "@/components/session"
import { useComments } from "@/context/comments"
import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import { shouldShowFileTree } from "@/pages/session/helpers"

/**
 * The `/new-session` draft page. Renders the prompt composer plus a lightweight file
 * tree sidebar (no terminal, review pane, or message timeline). Submitting promotes
 * the draft into a real session (see prompt-input/submit).
 */
export default function NewSessionPage() {
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const comments = useComments()
  const file = useFile()
  const layout = useLayout()
  const settings = useSettings()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()

  let inputRef: HTMLDivElement | undefined

  const composer = createSessionComposerState()

  const [store, setStore] = createStore({
    worktree: "main",
  })

  const newSessionWorktree = createMemo(() => {
    if (store.worktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
    return "main"
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

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  const isDesktop = createMediaQuery("(min-width: 768px)")

  // 文件树是否显示：桌面端 + 用户偏好 + 已展开
  const fileTreeOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: settings.visibility.fileTree(),
        opened: layout.fileTree.opened(),
      }),
  )

  // 文件树加载副作用：目录变化或首次展开时拉取文件列表
  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      <div class="flex-1 min-h-0 flex gap-2 p-2">
        <div class="@container relative flex flex-col min-h-0 h-full bg-background-stronger flex-1">
          <div class="flex-1 min-h-0 overflow-hidden rounded-[10px]">
            <NewSessionDesignView>
              <SessionComposerRegion
                state={composer}
                ready
                centered={false}
                placement="inline"
                inputRef={(el) => {
                  inputRef = el
                }}
                newSessionWorktree={newSessionWorktree()}
                onNewSessionWorktreeReset={() => setStore("worktree", "main")}
                onSubmit={() => comments.clear()}
                onResponseSubmit={() => {}}
                setPromptDockRef={() => {}}
              />
            </NewSessionDesignView>
          </div>
        </div>

        <Show when={fileTreeOpen()}>
          <aside
            id="file-tree-panel"
            aria-label="File tree"
            class="relative min-w-0 h-full shrink-0 overflow-hidden bg-background-stronger rounded-[10px] border-l border-border-weaker-base"
            style={{ width: `${layout.fileTree.width()}px` }}
          >
            <div class="h-full flex flex-col overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              <FileTree path="" class="pt-3" onFileClick={() => {}} />
            </div>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={layout.fileTree.width()}
              min={200}
              max={480}
              onResize={(width) => layout.fileTree.resize(width)}
            />
          </aside>
        </Show>
      </div>
    </div>
  )
}
