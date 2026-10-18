# cli serve handler 类型修复（Database/SessionV2 层补 provide）

## 需求背景

推送 ppt-master 迁移日志（`dd8e8dfdfa`）时，pre-push 钩子的全量 typecheck 拦截：`@opencode-ai/cli` 包报 TS2322——[index.ts](file:///d:/AI/opencode/packages/cli/src/index.ts) L23 挂载的 serve handler 类型不匹配：

```
Type 'Effect<void, unknown, Service | Service | Service>' is not assignable to type 'Effect<void, any, Service>'.
  Type 'database.Service' is not assignable to type 'daemon.Service'
```

即 serve handler 的 R 比框架期望的 `Daemon.Service` 多出 Database/SessionV2 等服务。

## 根因分析

- serve handler（[serve.ts](file:///d:/AI/opencode/packages/cli/src/commands/handlers/serve.ts)）里 `listen()` → `bind()` 用 `Layer.build(HttpRouter.serve(createRoutes(password)).pipe(...))` 把整条服务栈拉平
- **`HttpRouter.serve(...)` 这一层自身有 Database.Service / SessionV2.Service 两个输入洞**；serve.ts 原有 provide 只喂了 Credential/PermissionSaved 两个洞，剩两个漏到 handler 的 R
- createRoutes 内部（routes.ts L29-34）虽然 provide 了 DatabaseDefaultLayer 等，但**满足不到 serve 层的洞**——洞在 createRoutes 管道之外（这是本次诊断的关键结论）
- **为何现在才爆**：merge `859f44c3e3`（2026-07-04）后就潜伏；turbo typecheck 一直 cache hit 假绿，本次缓存失效真跑才暴露。10-12 的"push 全绿"实为缓存假象

## 备选方案（诊断与修复路径）

- 用临时探针文件（packages/cli/src/probe-tmp.ts，已删）分段复刻 bind 管道逐段看 RIn 收敛：裸 createRoutes 漏 4 个 Service（藏在 `Request<"Requires", Service>` 里）→ provideMerge(NodeHttpServer) 不变 → +Credential 减 1 → +PermissionSaved 减 1 → 剩 2 个
- 逐个补 provide 试错定位：+Database 减 1、+User/AuthToken/AuthAudit 无效、+EventV2/LocationServiceMap 无效、+SessionV2 归零
- 尝试过在 handlers.ts / routes.ts 管道补 provide——**均无效**（洞不在它们管道里），最终修在 cli serve.ts 的 bind()
- 备选的治本方案（改 routes.ts 让 createRoutes RIn 归零）实测无效已回滚，未采用

## 文件改动

- `packages/cli/src/commands/handlers/serve.ts`
  - L4-L5：新增 import `Database`（@opencode-ai/core/database/database）、`SessionV2`（@opencode-ai/core/session）
  - L43-L47：bind() 管道末尾补 `Layer.provide(Database.defaultLayer)` + `Layer.provide(SessionV2.defaultLayer)`，带 yejian 注释说明洞的位置与原因

## 影响范围

- 纯类型层修复 + bind 构建时多喂两个 provide；补的 Layer 与 createRoutes 内部 provide 的是**同一引用**，Layer.build 构建时 memoize 共享实例，**不重复建库/建会话服务，运行时行为零变化**
- 不影响容器（docker 镜像跑的是 opencode 主包的 web 服务，其 createRoutes 是 opencode 包自有的另一套，typecheck 本来就绿）

## 踩坑记录

1. **turbo typecheck 缓存假绿**：cli 包实际坏了几个月，历次 push 都显示 cache hit 全绿；缓存失效（本次疑似根目录文件变动触发）才暴露。教训：不能只信 hook 绿，重大 merge 后应在包目录手动跑一次真实 typecheck
2. **洞的位置直觉易错**：先在 handlers.ts/routes.ts 补 provide 全部无效——Effect 的 `Layer.provide` 喂的是管道自身未满足输入，跨管道边界（createRoutes → HttpRouter.serve）喂不到，必须修在消费侧（serve.ts bind）
3. **探针技巧**：tsgo 对联合类型只展开第一个不匹配成员，且 `Layer` 类型直接赋值 number 只显示别名；用「逐个补 provide 看漏出计数收敛」的二分法比读错误消息可靠

## 验证步骤

1. cli 包 `bun typecheck` 通过（修复前复现、修复后消失）
2. 删除探针文件后 cli 包再跑一次通过
3. push 触发 pre-push 全量 typecheck：23/23 通过（cli 为 cache miss 真跑）
4. `git push` 成功：`c9a1922fae..b362fddcdb`

## commit

- `b362fddcdb` `fix(yejian): provide Database and SessionV2 layers in cli serve handler`（serve.ts，+7 行）
