import { render } from "solid-js/web"
import App from "./App"
import "@opencode-ai/app/index.css"

const root = document.getElementById("root")
if (!root) throw new Error("根节点 #root 未找到")
render(() => <App />, root)
