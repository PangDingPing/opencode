import { Show, type JSX } from "solid-js"

type Props = {
  show: boolean
  x: number
  y: number
  placeholder?: boolean
  detail?: string
  keywords?: string[]
  example?: string
}

/**
 * 技能悬浮提示框（fixed 定位浮层）。
 * 用途：PanelOne 鼠标 hover 技能时显示详情/关键词/案例；占位技能仅显示"功能开发中"。
 * 入参：show 是否显示；x,y 屏幕坐标；placeholder 是否占位；detail/keywords/example 内容字段
 * 返回：浮层 JSX（鼠标穿透，永不抢焦点）
 */
export function SkillTooltip(p: Props): JSX.Element {
  return (
    <Show when={p.show}>
      <div
        style={{
          position: "fixed",
          left: `${p.x + 10}px`,
          top: `${p.y + 10}px`,
          "max-width": "320px",
          padding: "8px 12px",
          background: "#1f2937",
          color: "#e5e7eb",
          "border-radius": "6px",
          "box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
          "font-size": "12px",
          "line-height": "1.5",
          "z-index": 9999,
          "pointer-events": "none",
        }}
      >
        <Show
          when={p.placeholder}
          fallback={
            <>
              <Show when={p.detail}>
                <div style={{ "margin-bottom": "6px" }}>{p.detail}</div>
              </Show>
              <Show when={p.keywords && p.keywords.length > 0}>
                <div style={{ color: "#9ca3af" }}>关键词：{(p.keywords ?? []).join(", ")}</div>
              </Show>
              <Show when={p.example}>
                <div style={{ color: "#9ca3af", "margin-top": "4px" }}>例：{p.example}</div>
              </Show>
            </>
          }
        >
          <div>功能开发中</div>
        </Show>
      </div>
    </Show>
  )
}
