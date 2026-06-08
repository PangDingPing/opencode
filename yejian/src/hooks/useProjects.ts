import { createResource, type Resource } from "solid-js"
import { useSDK } from "@opencode-ai/app"
import { PROJECT_DIR_PREFIX, WORKSPACE_PATH } from "@yejian/config/app"
import { useCurrentUser } from "@yejian/hooks/useCurrentUser"

export type Project = {
  /** 去掉 "user-" 前缀的用户标识（手机号） */
  phone: string
  /** 项目目录绝对路径，例如 /workspace/user-13826001876 */
  path: string
}

type ProjectsApi = readonly [Resource<Project[]>, { refetch: () => void }]

/**
 * 当前用户的项目列表（UI 层隔离）。
 * 用途：调 opencode SDK 列出 /workspace 下的子目录，按 "user-" 前缀过滤，
 *       再仅保留 user-<当前手机号> 这一个项目；后端隔离不在本期范围。
 * 入参：无
 * 返回：[Resource<Project[]>, { refetch: () => void }]
 *
 * 实现细节：
 *   - sdk.client.file.list 第一参里同时给出 path 和 directory，
 *     directory 显式覆盖默认目录头，使本调用脱离当前 :dir 上下文，
 *     直接询问根 /workspace 的子目录列表。
 *   - 返回的 FileNode 数组里以 type === "directory" 过滤目录。
 */
export function useProjects(): ProjectsApi {
  const sdk = useSDK()
  const currentUser = useCurrentUser()

  const fetcher = async (phone: string): Promise<Project[]> => {
    if (!phone) return []
    const res = await sdk.client.file.list({
      directory: WORKSPACE_PATH,
      path: WORKSPACE_PATH,
    })
    const nodes = res.data ?? []
    return nodes
      .filter((f) => f.type === "directory")
      .filter((f) => f.name.startsWith(PROJECT_DIR_PREFIX))
      .map((f) => ({ phone: f.name.slice(PROJECT_DIR_PREFIX.length), path: f.absolute }))
      .filter((p) => p.phone === phone)
  }

  const [resource, { refetch }] = createResource(currentUser, fetcher, { initialValue: [] })
  return [resource, { refetch: () => void refetch() }] as const
}
