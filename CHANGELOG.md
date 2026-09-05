# 更新日志

## 1.8.1 Stable（2026-09-05）

- 发布 1.8.0 本地优化成果，继续使用原 `Viniper-Chu/viniper-ui` 仓库的正式发布通道。
- 补齐设置中的应用更新：GitHub 正式版检查、发布说明、真实下载进度、失败重试和完整安装包安装入口。
- 修复更新可能漏掉 Harness 运行时的问题；安装锁定当前目录，保护活跃任务，桌面优雅退出后交给原生安装器。
- 不携带个人聊天、Provider 凭据或本地测试数据；不更改两套 Agent 的独立数据边界。

## 1.8.0（2026-09-05，本地更新）

- 分开加载与保存两个 Agent 的设置，修复切换时的迟到响应、草稿和工作区串页；模型采用表格管理，高级设置折叠。
- Claude Code 补齐原生初始化、交互回复协议、命令发现和安全的会话恢复。交互式命令通过明确的原生终端入口执行；文件浏览提供受项目边界保护的真实预览。
- 缩短 Windows 交互记录的原子写临时文件名，修复深层目录下权限卡片无法显示的问题；运行中的文件错误不再误报为 CLI 未安装。
- 官方 DeepSeek 的原生主模型与子 Agent 映射按本轮设置隔离，避免旧模型环境污染；限制失败重试，提供可读错误与可恢复的发送状态。
- 子 Agent 输出保留在原生工具记录内，不再拼接到主 Agent 的回答正文。
- Viniper 实时流式输出；等待用户批准不再触发整段任务超时；取消和超时仅影响所属任务。计划保留未验证与受阻步骤，终端直接执行 PowerShell 7 脚本。
- 调整浅青色设置界面与窄窗排版。Windows 便携包及安装包的 EXE 写入正确品牌图标、名称和版本。
- 本轮不发布 GitHub，不清理个人数据；运行中 Viniper 续发仍为排队，直接引导未接通。macOS 未实测。

## 1.6.0 Stable（2026-08-27）

- 发布正式 Windows Stable 安装器 `Viniper-workstation-Setup.exe`，使用 `com.viniper.workstation` 与用户级安装目录。
- 保留 1.6.x 与既有 Workstation Preview 数据根的兼容租约；不迁移、不覆盖会话、SQLite、设置、记忆或安全存储。
- 固化 Viniper Harness 与原生 Claude Code CLI 的独立 runtime、transport、会话、权限、模型、Skills/插件和 MCP 数据边界，同时维持相同的前端位置与交互语义。
- 收口 ask/review/full（Viniper）与 default/acceptEdits/plan（Claude Code）权限投影，提供结构化计划、目标、协作、跨会话与子 Agent 状态。
- 提供真实工具/附件/diff、项目索引、LSP、代码导航、扩展与 MCP 管理，以及 Token、上下文和 Provider 缓存指标；无 Provider 数据时明确标注不可用。
- 修复 Windows 代理与回环 `NO_PROXY` 边界、运行时工具结果/计划恢复和稳定数据根租约；不改变用户 Provider、模型、密钥或现有会话。
- Windows x64 安装、冷启动、卸载边界和 Preview 回滚路径已验证；macOS 尚未验证。
