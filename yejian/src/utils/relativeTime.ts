/**
 * 把 UNIX 毫秒时间戳格式化为中文相对时间。
 * 入参：ms — 毫秒时间戳
 * 返回："刚刚" / "X 分钟前" / "X 小时前" / "昨天" / "X 天前" / 绝对日期
 */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分钟前"
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 小时前"
  if (diff < 172_800_000) return "昨天"
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + " 天前"
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * 绝对时间字符串（用于 Tooltip 显示）。
 * 入参：ms — 毫秒时间戳
 * 返回：YYYY-MM-DD HH:MM 格式字符串
 */
export function absoluteTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}