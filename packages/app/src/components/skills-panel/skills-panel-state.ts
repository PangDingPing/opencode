import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { SkillsPanelState } from "./skills-panel-types"

const STORAGE_KEY = "skills-panel"
const LEGACY_KEYS: string[] = ["skills-panel.v1"]

/**
 * 技能面板持久化状态：
 *  - open: 抽屉是否展开
 *  - expanded: 各分组的展开/折叠状态（手风琴，互不影响）
 */
export function createSkillsPanelState() {
  const [state, setState, , ready] = persisted(
    Persist.global(STORAGE_KEY, LEGACY_KEYS),
    createStore<SkillsPanelState>({
      open: false,
      expanded: {},
    }),
  )
  return { state, setState, ready }
}
