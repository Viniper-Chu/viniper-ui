# 更新日志

## 1.6.0 Stable（2026-08-27）

- 发布正式 Windows Stable 安装器 `Viniper-workstation-Setup.exe`，使用 `com.viniper.workstation` 与用户级安装目录。
- 保留 1.6.x 与既有 Workstation Preview 数据根的兼容租约；不迁移、不覆盖会话、SQLite、设置、记忆或安全存储。
- 固化 Viniper Harness 与原生 Claude Code CLI 的独立 runtime、transport、会话、权限、模型、Skills/插件和 MCP 数据边界，同时维持相同的前端位置与交互语义。
- 收口 ask/review/full（Viniper）与 default/acceptEdits/plan（Claude Code）权限投影，提供结构化计划、目标、协作、跨会话与子 Agent 状态。
- 提供真实工具/附件/diff、项目索引、LSP、代码导航、扩展与 MCP 管理，以及 Token、上下文和 Provider 缓存指标；无 Provider 数据时明确标注不可用。
- 修复 Windows 代理与回环 `NO_PROXY` 边界、运行时工具结果/计划恢复和稳定数据根租约；不改变用户 Provider、模型、密钥或现有会话。
- Windows x64 安装、冷启动、卸载边界和 Preview 回滚路径已验证；macOS 尚未验证。
