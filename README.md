# Viniper

Viniper 是面向 Windows 与 macOS 的本地桌面工作区。它把日常对话与 Claude Code 执行会话分成两个清晰表面：Chat 只负责聊天，Agent 通过 Claude Code CLI 执行本地任务、工具调用与权限交互。

## 主要能力

- Claude Code 风格的 Chat / Agent 双工作区与浅深色界面。
- 多个 Agent 会话并行运行；消息、上下文、队列、权限模式和交互请求按会话隔离。
- 行内 AskUserQuestion 与工具权限卡，支持多题、多选、其他答案、允许、拒绝和中断恢复。
- Enter 发送或排队，Ctrl+Enter 引导当前任务，Shift+Enter 只换行。
- 使用 Claude Code 的真实 context usage 与原生压缩边界显示上下文状态。
- 安全显示助手图片、工具图片与本地产物，不根据普通文本路径猜测文件。
- 设置中心可维护用户级 `AGENT.md`；Agent 每轮启动或恢复前读取，Chat 不注入。
- 本地技能库保留原始目录、命令和说明，并提供中文界面显示字段。
- GitHub Releases 自动更新；应用文件原子替换，用户会话、设置、附件和凭据留在安装目录之外。

## Claude Code 与技能

Windows Agent 使用受管 WSL2 运行环境；Chat 不启动 Claude Code 子进程。源码运行需要 Python 3.10+，桌面打包需要 Node.js 与 `desktop/package-lock.json` 对应的依赖。

Viniper 只同步兼容且不存在同名冲突的技能。运行 Agent 时，受管技能根通过 Claude Code 官方 `--add-dir` 参数加入启动命令，Claude Code 从该根的 `.claude/skills/<skill-name>/SKILL.md` 发现技能。原始技能目录与 `/command` 始终是真源；同名用户技能不会被覆盖，界面会如实显示“Claude Code 可用”“仅 Viniper 可用”或“冲突”。可用数量来自本机实时扫描，不是固定承诺。

## 安装与运行

公开 Release 提供 Windows 安装程序、macOS x64/arm64 包，以及供应用内更新使用的 app zip。源码运行：

```powershell
python -m pip install -r requirements.txt
python server.py
```

默认本地服务地址为 `http://127.0.0.1:17373`。

Provider 采用 Anthropic-compatible 配置：

- `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`

不要把 API key 提交到仓库。

## 用户数据与升级兼容

正式 5.0.2 的可见品牌为 Viniper，但继续使用 4.x 的桌面 App ID 和兼容数据标识，避免升级后丢失历史：

- Windows 正式版：`%APPDATA%\Viniper UI`
- Windows Preview：`%APPDATA%\Viniper Preview`（与正式版隔离）
- macOS 正式兼容目录：`~/Library/Application Support/Viniper UI`

更新只替换应用运行文件，不清空 sessions、settings、`AGENT.md`、skills、attachments 或凭据。

## Release 资产

同一 GitHub Release 包含：

- `Viniper.Setup.X.Y.Z.exe` 与对应 blockmap
- `Viniper.X.Y.Z-x64-mac.zip` 与对应 blockmap
- `Viniper.X.Y.Z-arm64-mac.zip` 与对应 blockmap
- `Viniper-vX.Y.Z.zip`
- `latest.json`

`latest.json` 的版本、资产名、公开 URL 与文件大小必须与同一 Release 中的真实资产一致。

## 本地验证与构建

```powershell
python -m unittest discover -s tests -v
python scripts/verify_app.py
python scripts/verify_provider_routing.py
python scripts/verify_desktop.py
python scripts/verify_release.py
```

构建 Windows 桌面安装器：

```powershell
python scripts/build_desktop.py --target win --skip-install
python scripts/build_release.py --version 5.0.2 --repo Viniper-Chu/viniper-ui
python scripts/verify_release.py --require-windows-installer
```

macOS 必须显式指定架构：

```bash
python3 scripts/build_desktop.py --target mac --arch x64
python3 scripts/build_desktop.py --target mac --arch arm64
```

正式桌面产物写入被 Git 忽略的 `desktop/release/`，更新包写入 `dist/`。构建会先创建显式白名单资源 staging，不遍历 `codex/`、`.omx/`、用户数据或本地证据。
