# 智囊评审：OpenCode Web 多用户改造可行性方案

> 评审时间：2026-06-25
> 评审对象：`multi-user-feasibility-analysis.md`
> 评审模式：正常模式（多视角并发）

---

## 方案概要

- **核心目标**：把单租户 OpenCode Web 改造为 30 人公司内部多用户系统（用户隔离 + 角色权限）
- **关键步骤**：5 阶段实施（数据层 → 后端认证 → 业务隔离 → 前端 → 部署）
- **涉及方**：审查师全员（30 人普通用户）+ 1~2 名 admin
- **资源/约束**：现有 SQLite 单文件、单进程、Effect HttpApi 框架、Drizzle 迁移
- **预期产出**：登录页 + 用户管理 + session 隔离 + admin-only credential 写入

## 任务类型识别

- **类别**：工作类（技术方案评审）
- **选用的专家视角**：
  - 视角 1：资深后端架构师（架构合理性、Effect HttpApi 改造、迁移设计）
  - 视角 2：安全专家（认证、密码、session、CSRF、限速）
  - 视角 3：魔鬼代言人（找边界场景、找被忽略的需求）

## 调研摘要

- **读取的文件**：
  - `packages/server/src/auth.ts`（现状认证）
  - `packages/server/src/middleware/authorization.ts`（现状中间件）
  - `packages/server/src/groups/credential.ts`（凭证 API）
  - `packages/core/src/session/sql.ts`（session 表 schema）
  - `packages/core/src/database/migration.ts`（迁移框架）
- **关键事实核对结果**：
  - ✅ 报告对 Basic Auth 实现、session 表无 user_id、credential API 缺 POST/GET、迁移框架机制的描述均准确
  - ⚠️ 报告未提及：`migration.ts:51-67` 有"老 Drizzle journal 兼容逻辑"——老项目如果有 `__drizzle_migrations` 表，迁移脚本会先导入 id 再判断
- **联网搜索**：未启用（项目内部技术决策，无外部标准依赖）
- **调用的其他 skill**：未调用

## 评审意见

### 🔴 严重问题（必须解决）

1. **【架构】project 表的归属语义没定义**
   报告 5.1 写了给 `project` 表加 `owner_id`，3 章也写了"项目按用户隔离"，但 4.7 实施代码**只改了 `SessionV2.list` 没改 `ProjectV2.list`**。30 人公司里：
   - 如果项目要严格隔离：那 `ProjectV2.list` 也得按 owner_id 过滤，新建项目时自动写 owner_id
   - 如果项目要共享：那 owner_id 字段根本不该加，删掉这步
   - **当前报告处于"半生不熟"状态**，开工时一定会有歧义。

2. **【安全】首次启动随机密码写入容器日志，老板可能看不到**
   报告 4.4 设计：环境变量没设密码时，启动打印随机密码到 stdout。**但 Docker 容器 stdout 默认不持久化**，老板如果用 `docker restart` 重启容器又没看 `docker logs`，密码就丢了。两条对策二选一：
   - **推荐**：**强制要求设置 `OPENCODE_SERVER_PASSWORD`**，没设直接拒绝启动（fail-fast，避免丢密码）
   - 备选：把密码同时写入 `docker-volume/.initial-admin-password`，启动后老板 `cat` 一下

3. **【安全】session_token 表缺 `revoked_at` 字段，"admin 踢人"无落地**
   报告 4.2 多次强调"admin 能踢人"是相比 JWT 的核心优势，但 4.2 的表设计**没有 `revoked_at` 字段**，只有 `expires_at`。这意味着"踢人"只能**删整行**——但删整行也丢失了"该用户登录过哪些设备"的审计信息。建议加 `revoked_at` + `revoked_by` 字段，admin 踢人时只更新不删除。

4. **【需求】4.5 章节前后矛盾**
   报告 4.5 末尾说："**普通用户能调 GET**（如果以后加 GET 的话，能看到'有 key'但看不到 key 内容）"，但同一节的端点设计里**没有定义 GET 端点**。这导致：
   - 普通用户登录后看到"提供商设置"页面是空的（没有任何"已配置的 key 列表"信息）
   - UX 上很怪——用户会问"为什么我的页面跟 admin 的不一样？"
   - **必须二选一**：要么补 GET 设计（admin 看完整列表，普通用户看脱敏列表），要么改需求"普通用户根本看不到提供商页面"。

5. **【合规】缺少审计日志（audit_log）设计**
   30 人公司里，admin 做了以下操作必须有可追溯记录：
   - 新建/删除/禁用用户
   - 重置用户密码
   - 添加/删除 credential
   - 踢人下线
   - admin 自己改自己密码
   报告**完全没设计 audit_log 表**。建议在数据层加一张表，admin 在 web 上能查询（用户管理页加个 tab）。

### 🟡 重要问题（建议解决）

1. **【安全】CSRF 防御机制没说明**
   SameSite=Lax 加上 30 人内部用，基本能挡住 95% 的 CSRF 攻击。但 4.2 章节**完全没提 CSRF**，也没解释"为什么不需要 CSRF token"。建议：
   - 文档里加一段说明（"依赖 SameSite=Lax，且不接受 cross-origin POST"）
   - 如果担心，可以加一个简单的 CSRF token 机制（双 cookie 模式）

2. **【安全】登录限速方案没说在哪一层做**
   报告 4.1 说"5 次失败锁 15 分钟"，但**没说在哪做**。SQLite 单文件没 Redis，方案只能是：
   - 新建 `login_attempt` 表（`ip`, `username`, `attempts`, `locked_until`）
   - 登录 handler 里先查这张表，超过阈值直接 429
   - **建议报告补一段设计**

3. **【性能】session 滑动续期的并发问题**
   报告 4.2 说"每次请求自动续期 14 天"。30 人并发，每人每分钟 ~5 个请求 = 每分钟 150 次 `UPDATE session_token`。**不是性能瓶颈**（SQLite WAL 模式完全扛得住），但有 ToCTOU 风险（同 token 多次并发 UPDATE）。建议：
   - 加一个 `last_extend_at` 字段，**每 5 分钟才续期一次**（即"惰性续期"）

4. **【安全】密码强度校验没说**
   报告 4.1 设计了 hash 方案，但**用户创建/重置密码时是否校验强度没提**。admin 在 web 上重置密码，如果没校验，他可能写 `123456`。建议：
   - 最少 8 位 + 必须含字母和数字（简单规则即可）
   - admin 创建/重置时前端做校验

5. **【安全】改密后是否踢出其他设备**
   报告没明说"用户改自己密码后，旧 session 是否全部失效"。**安全最佳实践是"踢出"**（防止账号被盗后攻击者保持登录）。建议：
   - 用户改密：把同 user_id 下所有 session_token 的 `revoked_at` 置为 now
   - admin 重置密码：同上 + 通知用户

6. **【需求】admin 能否"以某用户身份操作"**
   公司 IT 常见需求："老张离职了，他的 100 个 session 怎么交接给老李？"
   报告 3 需求表里**没提"代为操作"**，4.7 的 admin 设计是"看全员"但"不能伪装"。建议：
   - 加一个 `POST /api/admin/impersonate/:userID`（admin-only，会话切换）
   - 顶级导航显示"正在以 X 身份操作" + 一键退出

7. **【安全】`_legacy_system` 特殊 hash 设计的脆弱性**
   报告 4.3 用 `password_hash = '!disabled!'` 作为"永远 verify 失败"的特殊值。问题：**未来如果 verify 函数改了**（比如从 `argon2.verify(hash, password)` 改成 `crypto.timingSafeEqual(hash, expected)`），这个特殊字符串可能误通过。建议：
   - 在文档/迁移脚本里写明：**"任何 verify 实现必须先检查 password_hash 是否以 `!` 开头"**
   - 或在 schema 里加一列 `auth_disabled INTEGER NOT NULL DEFAULT 0`，verify 时查这列

8. **【架构】OPENCODE_WORKSPACE_ID 已有 workspace 概念，为什么不直接复用？**
   报告 2.3 自己提到 `session.workspace_id` 字段已经存在，是给"组织/工作区"用的。**为什么不用 workspace 概念实现"全员共享+个人隔离"**？比如：
   - 全员共用一个 workspace（`OPENCODE_WORKSPACE_ID=company_workspace`）
   - 个人隔离靠 user_id
   - **现在的方案是"user_id + workspace_id 并存"**，未来如果有跨 workspace 迁移需求会很乱。建议明确"workspace_id 的未来规划"。

9. **【运维】没有定期备份策略**
   报告 6.1 说"迁移前备份 .bak"，但**没设计日常定期备份**。30 人公司，单文件 SQLite，**硬盘坏了就完蛋**。建议：
   - 加一个简单的 cron 任务，每天凌晨 cp db 到 backup 目录，保留 7 天
   - 或在容器里跑一个 sidecar 定时备份

10. **【实施】阶段 1 估时 1.5 天偏紧**
    "新建 user 表 + session_token 表 + 4 个表加列 + legacy 账号 + 索引 + in-memory SQLite 验证"——1.5 天太紧。**in-memory SQLite 不能模拟"老库迁移"场景**（没有历史数据、没有触发迁移日志表的逻辑）。建议：
    - 阶段 1 拆成 1a（schema + 迁移脚本 + in-memory 验证）和 1b（真实老库 dry-run）
    - 1b 阶段从生产 cp 一份 db 出来，跑迁移验证，确认老 session 全划到 legacy

### 🟢 优化建议（锦上添花）

1. **【借鉴】OpenCode 官方多用户 schema 怎么没参考？**
   报告 9 参考资料里提了 `packages/console/core/src/schema/user.sql.ts`，**但没明说"为什么不直接用他们的"**。建议补一段对比："他们的 schema 是给 Cloudflare D1 设计的，跟我们 SQLite + 局域网部署不一致，所以参考表结构但自己写"。

2. **【架构】session cursor 分页与 user_id 过滤的结合没体现**
   报告 4.7 给的 list 代码示例是简化版，**实际项目里有 cursor 分页**。需要明确"user_id 过滤和 cursor 分页怎么叠加"——是过滤后再分页，还是在分页结果上过滤？建议在评审时对照现有的 `SessionV2.list` handler 看。

3. **【架构】v1 vs v2 路由都要改**
   报告重点写了 `SessionV2.list`，但**没提 v1 路由**。如果项目里 v1 还在用，v1 路由也要做 user 隔离 + admin 守卫。建议列出"v1 路由清单 + 改造点"。

4. **【文案】i18n key 命名规范要确认**
   报告 4.4 说加 8 条中文文案，**但没说要遵循 zh.ts 已有的 key 命名规范**。建议先扫一遍现有 zh.ts 的 key 风格再定。

5. **【架构】为什么不用 OPENCODE 官方 `account` 表的扩展模式？**
   报告 2.3 说 `account` 表"跟我们这事无关"，但**官方有类似 user_id 的字段**。如果不复制官方模式，理由是什么？建议明确。

6. **【工具】考虑加一个 `bin/opencode user` CLI 子命令**
   老板可能不总能在 web 上操作（忘了密码、Docker 出问题）。加一个 CLI 子命令：
   - `opencode user reset-password <username>`
   - `opencode user list`
   - `opencode user create <username> --admin`
   应急用，方便排查。

## 苏格拉底质疑（交互式）

- **核心假设挑战**："全员共用同一组 API key"这个需求——**真的需要吗**？30 人里可能部分人需要不同模型的 key（比如有的项目只能用国产模型）。如果不同人有不同 key，credential 表就不该是"全局可见"，而是按 user 隔离。这是个**会改变整个数据模型**的决策，必须先确认。
- **视角盲区**：报告从"实施者视角"出发，**没考虑"运维视角"**——比如：
  - 老张离职了，admin 怎么一键导出他的 session 内容（交接给同事）？
  - 30 人里有人误删了一个项目，admin 怎么从 SQLite 备份里恢复？
  - 这些"数据生命周期"场景报告没考虑。
- **反方论证**："不要做多用户"——如果 30 人都是审查师，**他们真的需要 session 隔离吗**？可能只是想要"统一认证+统一配置"就够了，session 共享也无妨。**多用户隔离本身可能就是过度设计**。建议先和 30 人开一次需求会，确认"session 互相看不到"是不是硬需求。

## 风险预警

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 老板看不到容器里的初始密码 | 🟡 中 | 🔴 高 | 强制要求设 `OPENCODE_SERVER_PASSWORD`，没设拒绝启动 |
| 改造后老 session 被锁进 `_legacy` 但 admin 想恢复 | 🟢 低 | 🟡 中 | 加"管理员接管老 session"工具按钮（8 章第 2 问里提了但没设计） |
| 30 人并发 SQLite 写锁竞争 | 🟢 低 | 🟡 中 | v0.0.5 实测 20+ 人无卡顿，但 30 人是边界，建议先压测再上线 |
| 有人改密后被踢，UX 没提示 | 🟡 中 | 🟡 中 | 前端在"修改密码成功"toast 里加"已踢出其他设备 X 台" |
| Docker 重建时旧容器有未提交数据 | 🟢 低 | 🔴 高 | 加 `docker/readme.md` 文档，强制要求先备份 db |

## 改进建议

1. **8 章"待确认细节"从 3 条扩到 10 条**，把上述关键决策点全列出来
2. **阶段 1 拆成 1a/1b**，1b 阶段必须用真实老库做 dry-run
3. **审计日志（audit_log）表**加入数据层设计
4. **项目（project）归属语义** 4.7 章节必须明确
5. **首次启动密码**强制要求 `OPENCODE_SERVER_PASSWORD`，fail-fast
6. **session_token 表**加 `revoked_at` 字段
7. **密码强度校验**在创建/重置时加
8. **改密踢出其他设备**作为默认行为
9. **"项目是否严格隔离"** "全员是否共用 credential" 这两个**架构级问题**先和老板确认再开工

## 改进版方案

> 评审发现 5 个严重问题，**直接给出修改后的章节设计**，老板对照改一下原报告即可。

### 改进后的 8 章"待确认细节"（10 条）

1. **首次启动 admin 密码**：✅ **强制要求 `OPENCODE_SERVER_PASSWORD`**，没设直接拒绝启动（避免 Docker 丢密码）
2. **老 session 数据归属**：现在 30 人系统里有多少历史 session？< 100 条全部划给 `_legacy_system`；> 1000 条加"管理员接管老 session"工具按钮
3. **用户自己改密码**：✅ 做（+0.5 天），改密后踢出其他设备
4. **【新增】项目（project）隔离语义**：✅ 严格隔离（每个 user 看不到其他人的 project）
5. **【新增】credential 可见性**：✅ 普通用户可看到"哪些 provider 配了 key"（脱敏），但看不到 key 内容；admin 看完整列表
6. **【新增】admin 代为操作**：❌ 一期不做（30 人不需要，二期可加）
7. **【新增】审计日志**：✅ 做（audit_log 表 + 用户管理页加 tab）
8. **【新增】改密后是否踢出其他设备**：✅ 是（默认行为，前端有提示）
9. **【新增】密码强度规则**：✅ 8 位+含字母数字
10. **【新增】定期备份**：❌ 一期不做（文档提一句建议，二期加 cron）

### 改进后的 4.2 节"session_token 表"

```sql
CREATE TABLE session_token (
  id              TEXT PRIMARY KEY,        -- token 本身
  user_id         TEXT NOT NULL REFERENCES `user`(id) ON DELETE CASCADE,
  expires_at      INTEGER NOT NULL,        -- unix ms
  last_extend_at  INTEGER NOT NULL,        -- 惰性续期
  revoked_at      INTEGER,                 -- 软删除，admin 踢人用
  revoked_by      TEXT REFERENCES `user`(id),
  time_created    INTEGER NOT NULL,
  user_agent      TEXT,                    -- 审计
  ip              TEXT                     -- 审计
);
CREATE INDEX session_token_user_idx ON session_token(user_id);
```

**惰性续期策略**：`now() - last_extend_at < 5min` 时不续期，避免高频 UPDATE。

### 改进后的 4.3 节"特殊 hash 设计"

不要用 `!disabled!` 字符串，改用**专门的列**：

```sql
CREATE TABLE `user` (
  ...
  disabled      INTEGER NOT NULL DEFAULT 0,  -- 0=正常 1=禁用
  ...
);
```

verify 时**先查 `disabled` 列**，disabled=1 直接拒绝。这样未来 verify 函数怎么改都不会误判。

### 改进后的 4.7 节"必须包含 ProjectV2"

```ts
// SessionV2.list
const sessionFilter = isAdmin ? query : { ...query, userID: current.id }

// ProjectV2.list  
const projectFilter = isAdmin ? query : { ...query, ownerID: current.id }

// 创建时自动归属
yield* project.create({ ..., ownerID: current.id })
```

## 替代方案（如有）

### 方案 A：复用 OpenCode 官方 `account` 表（不推荐）

OpenCode 已经有 `account` 表，理论上可以扩展它。但：
- 官方 `account` 是给 OpenCode Cloud 账号用的，不是局域网账号
- 改官方表会影响上游同步

**结论：新建 `user` 表是对的，不复用 account。**

### 方案 B：用 workspace_id 实现"全员共享+个人隔离"（部分推荐）

session 表已经有 `workspace_id` 字段。如果：
- 全员共用一个 workspace（OPENCODE_WORKSPACE_ID=company_workspace）
- 个人隔离靠 user_id
- 不需要跨 workspace 迁移

那 `workspace_id` 在新方案里**几乎没用**（因为全员共享）。建议：**第一期不考虑 workspace，直接用 user_id 简化**。第二期需要时再加。

## 评审结论

- **评审结果**：⚠️ **有条件通过**
- **通过条件**（10 条，老板先回答清楚再开干）：
  1. 8 章待确认细节从 3 条扩到 10 条
  2. 上述 5 个🔴严重问题在原报告里补全修改
  3. 4.7 必须包含 ProjectV2 的处理
  4. 4.2 session_token 表加 `revoked_at`、`last_extend_at` 字段
  5. 4.3 改用 `disabled` 列替代 `!disabled!` 特殊 hash
  6. 4.4 首次启动强制要求 `OPENCODE_SERVER_PASSWORD`
  7. 4.1 密码强度校验规则加进设计
  8. 数据层加 `audit_log` 表
  9. 阶段 1 拆成 1a/1b（1b 用真实老库 dry-run）
  10. 在开工前开一次需求会确认"全员共用 credential" 和 "项目严格隔离" 两个架构决策
- **核心理由**：报告**大方向正确、技术选型合理**，但**对边界场景和未来需求考虑不全**。改完上述 10 条后，方案就能进入实施。

---

> 评审完毕。修改完原报告后建议再走一遍评审（主要看"补得对不对"），不用重新走完整流程。
