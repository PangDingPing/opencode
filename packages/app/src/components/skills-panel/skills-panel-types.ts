// 技能面板类型定义

export type Skill = {
  /** 技能显示名称 */
  name: string
  /** 是否占位（功能开发中） */
  developing: boolean
  /** 调用的技能 ID（与 .opencode/skills/<dir> 对应） */
  skillId?: string
  /** Tooltip 详情段 */
  tooltip: string
  /** 调用关键词段（Tooltip 中显示） */
  keyword: string
  /** 使用案例段（Tooltip 中显示） */
  case: string
  /** 点击后填入 prompt-input 的预设文字 */
  prompt: string
}

export type SkillGroup = {
  /** 分组 ID（持久化 key 的一部分，必须稳定） */
  id: string
  /** 分组显示名 */
  name: string
  skills: Skill[]
}

export type SkillsData = {
  version: number
  groups: SkillGroup[]
}

/** 悬浮技能框持久化状态 */
export type SkillsPanelState = {
  /** 抽屉是否展开 */
  open: boolean
  /** 各分组是否展开（手风琴：互不影响） */
  expanded: Record<string, boolean>
}
