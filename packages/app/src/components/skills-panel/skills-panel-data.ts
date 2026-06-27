import type { SkillsData, Skill, SkillGroup } from "./skills-panel-types"

const SKILLS_JSON_URL = "/yejian/skills.json"

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === "string" &&
    typeof v.developing === "boolean" &&
    typeof v.tooltip === "string" &&
    typeof v.keyword === "string" &&
    (typeof v.case === "string" ||
      (Array.isArray(v.case) && v.case.every((c) => typeof c === "string"))) &&
    typeof v.prompt === "string" &&
    (v.action === undefined || v.action === "prompt" || v.action === "url") &&
    (v.url === undefined || typeof v.url === "string")
  )
}

function isSkillGroup(value: unknown): value is SkillGroup {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.skills) &&
    v.skills.every(isSkill)
  )
}

function isSkillsData(value: unknown): value is SkillsData {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return typeof v.version === "number" && Array.isArray(v.groups) && v.groups.every(isSkillGroup)
}

export async function loadSkillsData(): Promise<SkillsData> {
  const res = await fetch(SKILLS_JSON_URL, { cache: "no-cache" })
  if (!res.ok) {
    throw new Error(`加载技能 JSON 失败：HTTP ${res.status}`)
  }
  const json: unknown = await res.json()
  if (!isSkillsData(json)) {
    throw new Error("技能 JSON 结构校验失败")
  }
  return json
}
