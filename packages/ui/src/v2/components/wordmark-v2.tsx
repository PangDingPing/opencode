import type { ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"img">, "class">) {
  return <img src="/ai-workbench.png" alt="wordmark" class={props.class ?? ""} />
}
