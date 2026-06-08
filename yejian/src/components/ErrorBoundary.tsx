// 例外：此处使用别名 import 绕开本文件同名导出的命名冲突；
// 受 AGENTS.md "no alias imports" 约束的其他地方仍保持直接命名导入。
import { ErrorBoundary as SolidErrorBoundary, ParentProps, JSX } from "solid-js"

const btnStyle = (): JSX.CSSProperties => ({
  padding: "6px 12px",
  background: "#3b82f6",
  color: "white",
  border: "none",
  "border-radius": "4px",
  cursor: "pointer",
})

/**
 * 中文化错误边界。
 * 用途：兜底捕获子组件运行时错误，显示中文友好提示与"复制错误"按钮。
 * 入参：children
 * 返回：错误 fallback 或正常 children
 */
export function ErrorBoundary(props: ParentProps): JSX.Element {
  return (
    <SolidErrorBoundary
      fallback={(err: Error, reset: () => void) => (
        <div
          style={{
            padding: "20px",
            color: "#e2e8f0",
            "font-family": "system-ui",
          }}
        >
          <h2>出现了一个问题</h2>
          <p>请尝试刷新页面。如果问题持续，请把以下错误详情发给管理员：</p>
          <pre
            style={{
              background: "#1e293b",
              padding: "12px",
              "border-radius": "4px",
              overflow: "auto",
              "max-height": "200px",
            }}
          >
            {err.message}
            {"\n\n"}
            {err.stack}
          </pre>
          <div style={{ "margin-top": "12px", display: "flex", gap: "8px" }}>
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(`${err.message}\n\n${err.stack ?? ""}`)
                  .then(() => alert("已复制到剪贴板"))
              }
              style={btnStyle()}
            >
              复制错误详情
            </button>
            <button onClick={() => location.reload()} style={btnStyle()}>
              刷新页面
            </button>
            <button onClick={reset} style={btnStyle()}>
              重试
            </button>
          </div>
        </div>
      )}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}
