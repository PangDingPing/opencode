import { createResource, type Accessor, type Resource } from "solid-js"
import { useSDK } from "@opencode-ai/app"

export type SessionInfo = {
  id: string
  title: string
  /** 毫秒时间戳（取自 Session.time.updated） */
  updatedAt: number
}

type SessionsApi = readonly [Resource<SessionInfo[]>, { refetch: () => void }]

/**
 * 某项目目录下的 session 列表。
 * 用途：节点展开后按 directory 询问 opencode-server，列出该项目根 session；
 *       未展开时（dir 为 undefined）跳过加载，避免不必要请求。
 * 入参：dir — 项目绝对路径 Accessor；undefined 表示该项目未展开
 * 返回：[Resource<SessionInfo[]>, { refetch: () => void }]
 *
 * 实现细节：
 *   - 显式传 directory 覆盖 SDK 默认目录头，使列表脱离当前 :dir 上下文；
 *   - 用 scope=project + roots=true 排除其它项目和子 session，按 time.updated 倒序。
 */
export function useProjectSessions(dir: Accessor<string | undefined>): SessionsApi {
  const sdk = useSDK()

  const fetcher = async (directory: string): Promise<SessionInfo[]> => {
    if (!directory) return []
    const res = await sdk.client.session.list({
      directory,
      scope: "project",
      roots: true,
    })
    const sessions = res.data ?? []
    const list: SessionInfo[] = sessions
      .filter((s) => !!s?.id && !s.time?.archived)
      .map((s) => ({
        id: s.id,
        title: s.title ?? "(未命名会话)",
        updatedAt: s.time?.updated ?? s.time?.created ?? 0,
      }))
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }

  const [resource, { refetch }] = createResource(dir, fetcher, { initialValue: [] })
  return [resource, { refetch: () => void refetch() }] as const
}
