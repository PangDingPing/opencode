// yejian: 实例初始化等待者超时，防止慢初始化（慢插件/LSP/未知慢源）时首条请求无限挂死。
// 仅限制"等待者"，bootstrap fork 本身不受影响；等待期内初始化完成则请求正常通过。
// 超时后在 HTTP 边界（instance-context.ts）映射为 503，body 的 message 字段会被前端
// wrapClientError 提取并直接显示在 toast。
import { Duration, Schema } from "effect"

const DEFAULT_TIMEOUT_MS = 60_000

export class InstanceInitTimeoutError extends Schema.TaggedErrorClass<InstanceInitTimeoutError>()(
  "InstanceInitTimeoutError",
  {
    directory: Schema.String,
    waitedMs: Schema.Number,
  },
) {}

export function instanceInitTimeout() {
  const raw = Number(process.env.OPENCODE_INSTANCE_INIT_TIMEOUT_MS)
  const ms = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
  return Duration.millis(ms)
}

export * as InstanceInitTimeout from "./instance-init-timeout"
