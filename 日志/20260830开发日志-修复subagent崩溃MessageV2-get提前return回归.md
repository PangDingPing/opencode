# 20260830 开发日志 - 修复 subagent 崩溃（MessageV2.get 提前 return 回归）

## 需求背景

opencode v1.17.6 多用户版（docker v0.1.4）调用 subagent（task 工具）必现报错：

```
undefined is not an object (evaluating 'L.info.role')
```

`L` 是 `bun build --compile` 编译产物里的变量名，无法直接 grep 源码定位。用户要求结合上游 git 记录分析 v1.17.6 之后的版本是否修复了该问题，并给出修复报告、实施修复、构建 docker 镜像 v0.1.5、提交并打标签 `docker-v0.1.5`。

## 排查过程（上游对照结论）

1. 报错文案 `undefined is not an object` 是 JavaScriptCore（Bun）风格 → 崩溃在后端编译二进制，非前端。
2. subagent 入口 [task.ts](file:///d:/AI/opencode/packages/opencode/src/tool/task.ts) L164 是唯一无保护访问 `msg.info.role` 的调用方，其数据来自 `MessageV2.get`。
3. `git show v1.17.6` 对照发现：多用户改造把 `Database.Service` 批量改名为 `DatabaseService` 时，`MessageV2.get`（message-v2.ts L518-531）被误插一个提前 `return`，直接把**数据库原始行**返回——消息数据在 `row.data` 列里，原始行没有 `info` 属性 → `msg.info` 为 `undefined` → 崩溃；后面的 `info(row)` 水合和 `NotFoundError` 判空全部变成不可达死代码。
4. 上游 v1.17.6..dev（至 v1.18.25）无对应修复提交（subagent 相关只有错误呈现优化 `c313504c82` / `35fe5b7212`，与本崩溃无关）。**结论：不是上游 bug，是本仓库改名时引入的回归，只能本地修。**
5. 附带发现：HTTP 消息详情端点 `handlers/session.ts` L164 同样调用 `MessageV2.get`，一直在返回原始行，前端 `?.info?.id` 可选链静默吞掉了畸形数据 → 一并修好。

## 备选方案

| 方案 | 说明 | 取舍 |
| --- | --- | --- |
| A. 恢复上游 v1.17.6 原版 `get` 结构（保留 `DatabaseService` 命名） | 最小改动，`get` 与上游逐行一致，合并上游零冲突 | ✅ 采用 |
| B. 升级到上游 v1.18.x 再重放多用户改动 | 上游 subagent 无此修复，且多用户改动面大，成本高收益零 | ❌ 否决 |

## 文件改动（含行号）

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `packages/opencode/src/session/message-v2.ts` | L518-531 | 去掉多余 `return`，恢复上游 v1.17.6 原版：查行 → `info(row)` 水合为 `{ info, parts }` → 恢复 `NotFoundError` 判空。保留 `DatabaseService` 命名 |

代码改动仅 3 行（+3/-3）。

## 影响范围

- `MessageV2.get` 全代码库仅 2 个调用方：task.ts（subagent，崩溃点）+ HTTP 消息详情端点 handlers/session.ts L164（顺带修复返回畸形数据问题）。
- 无新文件、无 schema/接口变更、无前端改动。

## 踩坑记录

1. **"提前 return 消错"是高危写法**：批量改名 `Database.Service` → `Service as DatabaseService` 时，为消除编译报错插入的提前 `return` 让后续代码全部变成不可达死代码；TS typecheck 不报 unreachable code，运行期才崩。
2. **编译二进制报错无法 grep**：`L.info.role` 是编译器重命名后的变量，定位只能靠调用链推断 + 源码模式复现。
3. **PowerShell 不支持 bash 风格 heredoc**：`$(cat <<'EOF' ... EOF)` 报 "subexpression is missing the closing ')'"，commit message 改用多个 `-m` 参数分段。
4. **build.ps1 启动容器端口冲突**：脚本默认起 `yejian-AIworkbench`，8088 被旧 `yejian-v0.1.4` 容器占用报 `port is already allocated`；清理后按用户指定参数（`--name yejian-v0.1.5` + E 盘三个挂载 + `--env-file E:\AI\dockerimage\api-keys-v0.0.8.env` + `--restart always`）启动成功。
5. `git diff v1.17.6 HEAD` 比较的是提交历史，**不含工作区未提交改动**；验证修复效果要用 `git diff v1.17.6`（不带 HEAD）。
6. typecheck 全量报错均来自多用户改造既有文件（user/index.ts、server/handlers、TUI 等），与 message-v2.ts 无关——不能因为 typecheck 红 就跳过验证，要看**新增**报错。

## 验证步骤

1. `git diff v1.17.6 -- packages/opencode/src/session/message-v2.ts`：`get` 逻辑与上游完全一致，仅剩 `DatabaseService` 命名差异 ✅
2. `bun typecheck`（packages/opencode）：无新增错误（全部为既有错误）✅
3. `bun test test/tool/task.test.ts`：**18 pass / 0 fail**（63 断言），多个 execute 用例真实经过 `MessageV2.get` → `msg.info.role` 路径 ✅
4. Docker 构建：`.\docker\build.ps1 -EnvFile ... -ImageTag v0.1.5 -RebuildBuilder`（builder 重编译含修复源码 ~30s，runtime 全缓存复用，镜像 `yejian-opencode:v0.1.5` 导出成功）✅
5. 容器：`yejian-v0.1.5` 按用户指定参数运行（8088 端口、E 盘挂载、restart always），服务健康响应 ✅
6. **待用户冒烟**：网页登录 http://localhost:8088 后调一次 subagent，确认不再报 `L.info.role` 崩溃。

## Docker 部署信息

- 镜像：`yejian-opencode:v0.1.5`（tag `docker-v0.1.5`）
- 启动命令：

```powershell
docker run -d --name yejian-v0.1.5 -p 8088:8088 `
  -v "E:\AI\YEJIAN:/YEJIAN" `
  -v "E:\AI\AIworkbench-data/root:/root" `
  -v "E:\AI\AIworkbench-data/tmp:/tmp" `
  -w /YEJIAN `
  --env-file "E:\AI\dockerimage\api-keys-v0.0.8.env" `
  --restart always `
  --hostname 0.0.0.0 `
  yejian-opencode:v0.1.5
```

## commits

| commit | 内容 |
| --- | --- |
| `d1dfd2ed20` | fix(yejian): restore MessageV2.get to hydrate info and parts |
| `fa71e8c160` | docs(yejian): record MessageV2.get subagent crash fix in custom changes manifest |
| 本文件 + 日志.md 索引 | docs(yejian): write dev log for subagent crash fix（标签 `docker-v0.1.5` 打在此提交） |

## 已知遗留

- `bun typecheck` 的既有类型错误（多用户改造引入，约 50+ 条）未处理，属历史债务。
- 未做"同批改名文件的 return 后死代码"普查（智囊评审建议项），后续合并上游前建议过一遍 `git diff v1.17.6 -- packages/opencode/src`。
- 用户侧 subagent 冒烟验证尚未完成（等用户网页实际调用确认）。
