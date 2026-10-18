# ppt-master 技能迁移全局目录

## 需求背景

审查工作区项目目录 `E:\AI\YEJIAN\.opencode\skills\ppt-master`（容器内 `/YEJIAN/.opencode/skills/ppt-master`）里的 ppt-master skill 体量过大：**12,941 个文件 / 89.3MB**，混在项目级 skill 目录里不合适。希望迁到容器的**全局 skill 目录**，使项目目录瘦身，同时保持 ppt-master 在多用户 web 服务（容器 yejian-v0.1.7，镜像 yejian-opencode:v0.1.7）里继续可用。

容器启动参数关键挂载：
- `-v "E:\AI\YEJIAN:/YEJIAN"`（项目目录）
- `-v "E:\AI\AIworkbench-data/root:/root"`（容器 root 家目录）
- `-v "yejian-opencode-data:/root/.local/share/opencode"`（数据卷，与 skill 无关）

## 分析结论（全局 skill 目录到底在哪）

从源码确认三处证据：

1. `packages/core/src/global.ts` L13：`config = path.join(xdgConfig!, "opencode")`——Linux 下未设 `XDG_CONFIG_HOME` 时 `xdgConfig` = `$HOME/.config`，容器以 root 运行 → **`/root/.config/opencode`**
2. `packages/opencode/src/config/paths.ts` L23-L41：`ConfigPaths.directories()` 返回的扫描范围 = `Global.Path.config`（全局）+ 项目向上查 `.opencode` + home 下 `.opencode` + 可选 `OPENCODE_CONFIG_DIR`
3. `packages/opencode/src/skill/index.ts` L24 / L207：skill 扫描模式为 `{skill,skills}/**/SKILL.md`，对上述每个配置目录执行——所以全局放 `skills/` 子目录（复数）即可被识别

实测验证：容器内无任何 `XDG_CONFIG_HOME` / `OPENCODE_CONFIG_DIR` 环境变量（Dockerfile 也未设置）；`/root/.config/opencode/` 已存在（含 opencode.jsonc）。

**结论**：容器全局 skill 目录 = `/root/.config/opencode/skills/` = 宿主机 `E:\AI\AIworkbench-data\root\.config\opencode\skills\`（经 `/root` 挂载映射）。另注意 `/root/.local/share/opencode`（named volume）是数据目录，不放 skill。

## 备选方案

- 全局位置二选一：① `~/.config/opencode/skills/`（全局配置目录，opencode 规范做法）② `~/.opencode/skills/`（home 级 .opencode，paths.ts 同样支持）。选 ①，与全局配置文件 opencode.jsonc 同处一处便于管理
- 迁移策略：先复制后删除（robocopy 复制 → 验证 → 重启 → debug skill 验证 location 指向全局 → 原目录改名 `.bak` → 再重启复验 → 删除 `.bak`），避免直接移动导致服务中断无法回退
- 复制方式：宿主机 robocopy（两端都是宿主机挂载路径，无需 docker cp）

## 文件改动

本仓库（d:\AI\opencode）代码**零改动**，纯文件迁移 + 容器操作：

| 操作 | 路径 |
|---|---|
| 复制源（后已删除） | `E:\AI\YEJIAN\.opencode\skills\ppt-master`（12,941 文件 / 75.87MB，robocopy 统计） |
| 复制目标（保留） | `E:\AI\AIworkbench-data\root\.config\opencode\skills\ppt-master` |
| 临时备份（已删除） | `E:\AI\YEJIAN\.opencode\skills\ppt-master.bak` |
| 容器内临时排查文件（已删除） | `/tmp/skilllist.json`、`/tmp/skillerr.txt` |

## 影响范围

- 审查工作区项目目录减少 12,941 个文件
- 全局 skill 对容器内所有项目/实例可见；当前多用户 web 服务只用 `/YEJIAN` 一个项目，实际可见性与迁移前一致
- ppt-master SKILL.md 内部引用的 `/YEJIAN/users.json`、`PPT_MASTER_PROJECTS_DIR` 等绝对路径不受影响（`/YEJIAN` 挂载未变）
- 其余 30 个 skill 不受影响；`E:\AI\YEJIAN` 若纳入 git 管理，删除 ppt-master 需相应提交

## 踩坑记录

1. **PowerShell 5 不支持 `&&` / `||` 语句分隔符**——`Rename-Item ... && Get-ChildItem ...` 直接 ParserError，须用 `;`（本次再次踩到，已知事项）
2. **PowerShell 5 给 docker exec 传参会吃掉嵌套引号**：`sh -c "grep -o '\"location\"...' "` 和 `python3 -c 'import json; d=json.load(open("/tmp/..."))'` 里的双引号全部丢失，python 报 SyntaxError。绕过办法：把 python 代码用 **base64 编码**后 `docker exec ... python3 -c "import base64;exec(base64.b64decode('$b64').decode())"`，彻底避开引号转义
3. **robocopy 退出码 0-7 均为成功**（1=已复制文件），shell 工具按非零判失败，需 `if ($LASTEXITCODE -le 7) { exit 0 }` 兜底
4. **`echo exit=$?` 中的 `$?` 被 PowerShell 提前展开**：双引号字符串里 PowerShell 把 `$?` 换成自己的 True/False，sh 收到的不是上一命令退出码。调试输出出现 `exit=True` 就是这个原因
5. **skill 同名重复的覆盖顺序不确定**：`skill/index.ts` 的 `add()` 遇到重名只打 warning 且后加载者覆盖先加载者，而 `loadSkills` 用 `concurrency: "unbounded"` 并发加载，完成顺序不保证——所以新旧两处共存期间 ppt-master 到底用哪份是有随机性的，**迁移必须删干净项目里的副本**，不能长期共存
6. 中间一次 `grep ppt-master/SKILL.md` 报 "No matches found" 疑似 skill 丢失，实为 PowerShell→sh 的传参/输出管道噪音；换 python json 解析后确认 31 个 skill 全部正常

## 验证步骤

1. robocopy 统计：Dirs 151 / Files 12,941 / Bytes 75.87 MB / **FAILED 0**
2. 容器内 `find /root/.config/opencode/skills/ppt-master -type f | wc -l` = **12941**，SKILL.md frontmatter（name: ppt-master）正常
3. 第一次 `docker restart` 后：`docker exec -w /YEJIAN yejian-v0.1.7 opencode debug skill` → ppt-master 的 `location` 为 **`/root/.config/opencode/skills/ppt-master/SKILL.md`**（全局生效）
4. 原目录改名 `.bak` 后第二次 `docker restart` 复验：base64 方式解析 debug skill 输出 → **total: 31**，`ppt-master -> /root/.config/opencode/skills/ppt-master/SKILL.md`，`pptx` 等其余 skill 仍指向项目目录，`skillerr.txt` 无 SkillInvalidError
5. 删除 `.bak` 后确认 `E:\AI\YEJIAN\.opencode\skills` 下已无 ppt-master* 残留；容器内临时文件已清理

## commit

无。本次未改动 d:\AI\opencode 仓库代码，为审查工作区文件迁移 + 容器运维操作。
