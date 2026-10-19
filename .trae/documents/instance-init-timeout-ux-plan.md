# 实施方案 B（瘦身版）：部署加固 + 实例初始化等待者超时

> 版本：v2（2026-10-19，按两轮智囊评审结论修订）
> 评审记录：[智囊评审-全量方案](file:///d:/AI/opencode/.trae/documents/智囊评审-20261019-实例初始化超时方案.md)（⚠️ 有条件通过）、[智囊评审-方案B](file:///d:/AI/opencode/.trae/documents/智囊评审-20261019-方案B-瘦身版.md)（⚠️ 有条件通过，4 条条件已全部落实于本文）

## Context（背景）

Docker 多用户部署中，「用户+目录」首次请求触发实例初始化。此前故障根因：容器内 `npx @playwright/mcp@latest` 访问 npm 官方源极慢（3 次 ETIMEDOUT 重试 ≈ 80s，冷启动数分钟），阻塞首个 prompt → 静默挂死 → 用户中止时打出 EPIPE 噪音。**根因已修复**（npmmirror 镜像源 + 固定版本 0.0.83，npx 80s→2s）。

本方案防「下一次同类故障」，收敛为两层：

1. **根因侧加固**（层1+层2）：MCP 包本地化，运行时零网络依赖——消除已知慢源
2. **最后防线**（S1）：等待者超时，任何未知慢源（慢插件/LSP 下载/新增 MCP/配置改坏）下请求不再无限挂死，超时返回可读 503

原全量方案中的 S2（进度事件）、S3（MCP 超时降级）、F1（前端横幅+重试）**移入观察清单**（见文末），不再实施。

## 已验证前提（源码级，2026-10-19）

| # | 验证点 | 结论 |
| --- | --- | --- |
| V1 | 等待者可中断 | [instance-store.ts:113,121](file:///d:/AI/opencode/packages/opencode/src/project/instance-store.ts#L113-L121) `restore(Deferred.await(...))` 可中断，`Effect.timeout*` 生效 |
| V2 | 超时不触碰缓存 | 仅 `completeLoad` 失败才 `removeEntry`；超时后 Deferred 仍 pending，重试命中同一 Deferred，初始化完成即成功 |
| V3 | Effect v4 API | `Effect.timeoutOrElse`（项目先例 [mcp-websearch.ts:92](file:///d:/AI/opencode/packages/opencode/src/tool/mcp-websearch.ts#L92)）直接给自定义失败，非超时错误原样透传；`HttpServerResponse.jsonUnsafe(body, {status})`（先例 [global.ts:174](file:///d:/AI/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts#L174)） |
| V4 | 前端 503 链路 | `promptAsync` 503 → [wrapClientError](file:///d:/AI/opencode/packages/sdk/js/src/error-interceptor.ts#L24-L31) 提取 body `message` → [submit.ts:582-594](file:///d:/AI/opencode/packages/app/src/components/prompt-input/submit.ts#L582-L594) toast 报错 + 回滚乐观消息 + **恢复输入框**（可原地重发）；新会话场景 `session.create`/`worktree.create` 同样有 toast catch |
| V5 | 前端不会提前掐断长等待 | SDK 自定义 fetch 路径显式禁用超时（[client.ts:54](file:///d:/AI/opencode/packages/sdk/js/src/v2/client.ts#L54) `req.timeout = false`），60s 服务端等待可完整到达前端 |
| V6 | 503 必须 `application/json` | 否则 body 不被解析为对象，`message` 提取退化为裸状态码——用 `jsonUnsafe` 天然满足（**实施时不得改用纯 raw 响应**） |
| V7 | npx 缓存已持久化 | `/root` bind mount（[run.ps1:64](file:///d:/AI/opencode/docker/run.ps1#L64)）→ `E:\AI\AIworkbench-data\root\.npm\_npx\` 已含 `@playwright/mcp@^0.0.83` |

## 交互时序（改造后）

```
用户在会话页发送消息（或新会话创建 session/worktree）
  → 实例上下文中间件：store.load() 等待 Deferred（≤ 60s，OPENCODE_INSTANCE_INIT_TIMEOUT_MS 可覆盖）
      ├─ 等待期内初始化完成 → 正常通过，消息正常处理（用户仅感觉首条消息稍慢）
      └─ 超过 60s（病态场景） → 503 { message: "环境正在初始化（已等待 X 秒），请稍后重试；输入已恢复。" }
            → 前端 toast 显示该文案 + 乐观消息回滚 + 输入框内容恢复
            → 用户稍后重发：命中同一 Deferred，初始化已完成则立即成功
```

## 方案

### 层1：npx 离线优先（配置级，立即生效，零代码）

[opencode.jsonc](file:///E:/AI/AIworkbench-data/root/.config/opencode/opencode.jsonc) MCP 命令改为：

```json
["npx", "-y", "--prefer-offline", "@playwright/mcp@0.0.83", "--cdp-endpoint=http://192.168.1.81:9081"]
```

原理：npx 即使缓存命中，默认每次仍向 registry 发元数据校验请求（304 revalidation）——弱网下即 3×ETIMEDOUT 来源；`--prefer-offline` 跳过校验直接用缓存 tarball。缓存缺失时仍正常下载（不会变砖），首次成功后运行时零网络。

### 层2：镜像预装，甩掉 npx（需重建镜像，随下次版本升级捎带）

[Dockerfile](file:///d:/AI/opencode/docker/Dockerfile) 现有全局安装行追加一个包（沿用既有 cache mount 模式）：

```dockerfile
RUN npm install -g docx pdf-lib pdfjs-dist @playwright/mcp@0.0.83
```

[opencode.jsonc](file:///E:/AI/AIworkbench-data/root/.config/opencode/opencode.jsonc) 改为直接调 bin：

```json
["mcp-server-playwright", "--cdp-endpoint=http://192.168.1.81:9081"]
```

- **实施时验证 bin 名**：`docker exec <容器> sh -c "cat /usr/local/lib/node_modules/@playwright/mcp/package.json | grep -A3 bin"`，按实际输出调整
- 收益：运行时彻底无网络、省 npx 每次 1-2s 解析/spawn 开销（多用户下每个新用户首次 prompt 都会 spawn）、不依赖 `/root` 缓存
- **窗口期**：层2 生效前层1 是主防线；`docker/readme.md` 需写明

### S1：等待者超时 → 可读 503（新建 1 文件 + 改 2 文件）

新建 `packages/opencode/src/project/instance-init-timeout.ts`：

```ts
// yejian: 实例初始化等待者超时，防止慢初始化（慢插件/LSP/未知慢源）时首条请求无限挂死。
// 仅限制"等待者"，bootstrap fork 本身不受影响；等待期内完成则请求正常通过。
import { Duration } from "effect"

const DEFAULT_TIMEOUT_MS = 60_000

export class InstanceInitTimeoutError extends Error {
  constructor(readonly directory: string, readonly waitedMs: number) {
    super(`instance init timeout after ${waitedMs}ms: ${directory}`)
  }
}

export function instanceInitTimeout(): Duration.Duration {
  const raw = Number(process.env.OPENCODE_INSTANCE_INIT_TIMEOUT_MS)
  const ms = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
  return Duration.millis(ms)
}
```

修改 [instance-store.ts](file:///d:/AI/opencode/packages/opencode/src/project/instance-store.ts) `load()`（`reload()` 同样处理，两处等待点均包装）：

```ts
// 改动前：return yield* restore(Deferred.await(existing.deferred))
// 改动后：
const started = Date.now()
return yield* restore(
  Deferred.await(existing.deferred).pipe(
    Effect.timeoutOrElse({
      duration: instanceInitTimeout(),
      orElse: () => Effect.fail(new InstanceInitTimeoutError(directory, Date.now() - started)),
    }),
  ),
)
```

- 接口签名 `load`/`reload` 错误通道从 never 扩展为 `InstanceInitTimeoutError`
- **不改** `dispose`/`disposeDirectory`/`disposeAll` 中的 `Deferred.await`——清理路径必须等真实结果，不该有超时
- 缓存条目保留（V2），无需清理逻辑

修改 [instance-context.ts](file:///d:/AI/opencode/packages/opencode/src/server/routes/instance/httpapi/middleware/instance-context.ts)：

```ts
const ctx = yield* store.load({ directory: decode(route.directory) }).pipe(
  Effect.catch((error) => {
    if (!(error instanceof InstanceInitTimeoutError)) return Effect.fail(error)
    // yejian: 503 body 的 message 字段会被前端 wrapClientError 提取并直接显示在 toast（已验证 V4）；
    // 必须用 jsonUnsafe 保证 application/json content-type（V6）
    return Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        {
          message: `环境正在初始化（已等待 ${Math.round(error.waitedMs / 1000)} 秒），请稍后重试；输入已恢复。`,
        },
        { status: 503, headers: { "Retry-After": "10" } },
      ),
    )
  }),
)
```

### 不做 / 观察清单

| 项 | 原方案定位 | 移入观察理由 | 重启触发条件 |
| --- | --- | --- | --- |
| S2 bootstrap 进度事件 | 初始化可观测 | 503 文案已含等待时长，观测可用 docker logs + 日志时间戳 | 需要用户侧实时进度时 |
| S3 MCP 总超时降级 | MCP 慢不阻塞 prompt | 层1+层2 后 MCP 已本地化；且 ScopedCache 对降级结果照常缓存（上轮评审问题 1），语义需重设计 | 新增慢 MCP 场景实际出现时 |
| F1 前端横幅+重试 | 初始化过程可见、自动恢复 | 503 → toast + 输入恢复已可用（V4）；横幅属体验增强 | 60s 报错体验被实际投诉时 |

### 不做的事

- 不改上游启动逻辑、不引入新依赖、不加轮询端点
- 不做前端任何改动（`packages/app` 零改动）

## 涉及文件清单

| 类型 | 文件 |
| --- | --- |
| 新建 | `packages/opencode/src/project/instance-init-timeout.ts` |
| 修改 | `packages/opencode/src/project/instance-store.ts`（两处等待点超时包装）、`packages/opencode/src/server/routes/instance/httpapi/middleware/instance-context.ts`（503 映射） |
| 配置 | `docker/Dockerfile`（全局安装加一包）、容器内 `/root/.config/opencode/opencode.jsonc`（MCP 命令，先层1 后层2 两次调整） |
| 文档 | `自定义改动.md`（新增小节）、`docker/readme.md`（MCP 本地化一节 + 环境变量表补 `OPENCODE_INSTANCE_INIT_TIMEOUT_MS`）、`日志/20261019开发日志-实例初始化超时与部署加固.md` |

## 实施顺序

1. **层1**：改 [opencode.jsonc](file:///E:/AI/AIworkbench-data/root/.config/opencode/opencode.jsonc) → 容器内验证 `npx --prefer-offline` 离线可用
2. **S1**：新建 `instance-init-timeout.ts` + 改 instance-store / instance-context → `packages/opencode` 目录 `bun typecheck`
3. **冒烟**：慢初始化注入验证（见下）→ 正常配置回归
4. **层2**：Dockerfile 加包 → 下次镜像重建时生效，届时验证 bin 名并二次调整 opencode.jsonc
5. **文档**：`自定义改动.md`、`docker/readme.md`、开发日志；按 `feat(yejian)` 分文件提交（推送前请用户确认）

## 验证方式

1. **typecheck**：`packages/opencode` 目录 `bun typecheck`
2. **慢初始化注入**：测试配置临时新增本地 MCP `{ "command": ["sleep", "300"] }`（不碰生产配置），验证：
   - 首条消息 60s 后收到 toast：文案 = 503 body 的 message（非裸状态码）
   - 乐观消息被回滚、输入框内容恢复
   - 移除注入重启后重发 → 立即成功
3. **正常回归**：正常配置下首条消息体验无变化（本地源码模式 + Docker 冒烟各一轮）
4. **层1 验证**：容器内 `npx -y --prefer-offline @playwright/mcp@0.0.83 --help` 断网/离线环境可跑通

## 风险与边界

- 超时后 bootstrap 仍在后台继续（fork 未被打断）：重试命中同一 Deferred，初始化完成即刻成功——语义正确（V2）
- 503 仅发生在「实例未就绪」窗口且超时为病态判定（层1+层2 后正常初始化秒级）；每轮重试最长等满超时才报错，无轮询风暴
- 等待期内用户看到乐观消息 + busy——黑盒最长 60s；toast 文案已含「已等待 X 秒」缓解困惑
- 503 未进入业务 handler，消息未入库、会话未创建——重试无重复消息风险
- 多用户隔离不受影响：超时按 directory 独立，503 body 仅含目录与等待时长，无用户敏感信息
- 上游合并面：1 个新文件 + 2 处带 `// yejian:` 注释的小改，冲突面极小
