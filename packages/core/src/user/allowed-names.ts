import { Effect } from "effect"
import fs from "fs"
import path from "path"

/**
 * 实名白名单读取模块
 * - 从 env 变量 OPENCODE_ALLOWED_NAMES_FILE 指定的路径读取白名单文件
 * - 本地开发时回退到项目根目录的 docker/allowed-names.txt
 * - 文件格式：每行一个名字，# 开头的行为注释
 */

// 白名单文件路径：优先 env 变量，本地开发回退到 docker/allowed-names.txt
function allowedNamesPath(): string {
  const envPath = process.env.OPENCODE_ALLOWED_NAMES_FILE
  if (envPath && fs.existsSync(envPath)) return envPath

  // 本地开发回退：从 core 包向上找到项目根目录
  const root = path.resolve(import.meta.dirname, "../../..")
  return path.join(root, "docker/allowed-names.txt")
}

// 缓存白名单（启动时读一次）
let cachedNames: string[] | null = null

/**
 * 读取白名单文件，返回实名列表
 * - 跳过空行和 # 开头的注释行
 * - 去除首尾空格
 * - 结果按文件顺序保持
 */
export function loadAllowedNames(): string[] {
  if (cachedNames) return cachedNames

  const filePath = allowedNamesPath()
  const content = fs.readFileSync(filePath, "utf-8")

  cachedNames = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  return cachedNames
}

/**
 * 检查名字是否在白名单内
 * - 区分大小写
 * - 必须完全匹配
 */
export function isAllowedName(name: string): boolean {
  return loadAllowedNames().includes(name)
}

/**
 * 清除缓存（测试用，或文件更新后强制重新读取）
 */
export function clearCache(): void {
  cachedNames = null
}
