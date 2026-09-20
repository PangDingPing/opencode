import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

class GlobalBusEmitter extends EventEmitter<{
  event: [GlobalEvent]
}> {
  override emit(eventName: "event", event: GlobalEvent): boolean {
    if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return super.emit(eventName, event)
  }
}

// yejian: 多用户部署下每条 SSE 连接会注册一个 GlobalBus 监听器，30 用户规模
// 超过 EventEmitter 默认上限 10，触发误导性 MaxListenersExceededWarning，按真实并发规模上调
export const GlobalBus = new GlobalBusEmitter()
GlobalBus.setMaxListeners(200)
