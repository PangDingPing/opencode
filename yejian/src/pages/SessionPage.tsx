import { useParams } from "@solidjs/router"

/**
 * Session 页面占位实现。
 * 用途：在 Task 5-7 替换为真实四列布局；本任务仅验证 Provider 链与路由通畅。
 * 入参：路由 :dir 与 :id（base64 编码的目录路径与 session id）
 * 返回：占位 JSX
 */
export default function SessionPage() {
  const params = useParams()
  return (
    <div
      style={{
        padding: "20px",
        color: "#e2e8f0",
        background: "#0f172a",
        "min-height": "100vh",
        "font-family": "system-ui, sans-serif",
      }}
    >
      <h2>SessionPage 占位（Task 3 验证用）</h2>
      <p>dir = {params.dir ?? "(未指定)"}</p>
      <p>id = {params.id ?? "(未指定)"}</p>
    </div>
  )
}
