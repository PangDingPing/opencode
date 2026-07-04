import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { ForbiddenError } from "../errors"

// admin 守卫中间件 class 定义
// 放 protocol 层供 groups/admin.ts 等 protocol 层文件 import
// requireAdmin 的实现 layer 留在 server 包（依赖 CurrentUser）
export class RequireAdmin extends HttpApiMiddleware.Service<RequireAdmin>()("@opencode/RequireAdmin", {
  error: ForbiddenError,
}) {}
