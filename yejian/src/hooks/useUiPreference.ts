import { createSignal, createEffect } from "solid-js"

type Prefs = {
  panelTwoVisible: boolean
  reviewVisible: boolean
  terminalVisible: boolean
  panelOneWidth: number
  panelTwoWidth: number
  reviewWidth: number
}

const KEY = "yejian.ui.prefs.v1"

const DEFAULT: Prefs = {
  panelTwoVisible: true,
  reviewVisible: false,
  terminalVisible: false,
  panelOneWidth: 180,
  panelTwoWidth: 220,
  reviewWidth: 280,
}

/**
 * 持久化 UI 偏好（折叠状态 + 列宽）。
 * 用途：所有面板折叠/拖动的状态通过本 hook 读写 localStorage，下次进入恢复。
 * 入参：无
 * 返回：[读取函数, 更新函数]
 */
export function useUiPreference() {
  const initial: Prefs = (() => {
    const raw = (() => {
      try {
        return localStorage.getItem(KEY)
      } catch {
        return null
      }
    })()
    if (!raw) return DEFAULT
    const parsed = (() => {
      try {
        return JSON.parse(raw) as Partial<Prefs>
      } catch {
        return {}
      }
    })()
    return { ...DEFAULT, ...parsed }
  })()
  const [prefs, setPrefs] = createSignal<Prefs>(initial)
  createEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs()))
    } catch {
      // 隐私模式可能 setItem 抛错；忽略即可
    }
  })
  return [prefs, setPrefs] as const
}