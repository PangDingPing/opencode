import { createContext, createSignal, useContext, type ParentProps, type JSX } from "solid-js"

type SkillPromptCtx = {
  pendingPrompt: () => string | null
  setPrompt: (text: string) => void
  consume: () => void
}

const Ctx = createContext<SkillPromptCtx>()

/**
 * SkillPrompt 上下文 Provider。
 * 用途：在 PanelOne 与 SessionComposerRegion 之间架一座单向信号桥——
 *      PanelOne 调用 setPrompt 写入待填充提示词，SessionPage 内部消费后调用 consume 清空。
 * 入参：children
 * 返回：SolidJS Provider 节点
 */
export function SkillPromptProvider(props: ParentProps): JSX.Element {
  const [pendingPrompt, setPendingPrompt] = createSignal<string | null>(null)
  const value: SkillPromptCtx = {
    pendingPrompt,
    setPrompt: (t) => setPendingPrompt(t),
    consume: () => setPendingPrompt(null),
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

/**
 * 消费 SkillPrompt 上下文。
 * 用途：在 SkillPromptProvider 子树内的任何组件中读取 pendingPrompt 信号
 *      或调用 setPrompt/consume。
 * 入参：无
 * 返回：上下文对象；未包 Provider 时抛错。
 */
export function useSkillPrompt(): SkillPromptCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSkillPrompt 必须在 <SkillPromptProvider> 内使用")
  return v
}
