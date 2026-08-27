# Viniper workstation 1.6.0 Stable

Viniper workstation 是面向 Windows 的双 Agent 工作台。它保留熟悉的 Viniper 壳与浅青视觉，同时把两个运行时严格分开：

- **Viniper Harness**：自研 Harness Runtime/Application Port，负责 Viniper 会话、工具、权限、计划、目标、协作、跨会话消息与子 Agent。
- **Claude Code CLI**：只调用本机原生 Claude Code CLI；其会话、权限、任务/计划投影、Skills 与插件数据不复用 Harness。

两边共享前端语义和位置（消息框、附件、模型、上下文环、Token、状态、设置层级），不共享 transport、runtime、store、会话、模型、权限持久化或密钥。权限档位的语义也由各自 owner 执行：Viniper 的 ask/review/full 与 Claude Code 的原生 default/acceptEdits/plan 分别映射到各自后端。

## 能力范围

工作台支持附件、结构化 plan/goal、任务委派与跨会话协作、受控子 Agent、真实工具/文件 diff、项目索引与代码导航、LSP、Skills、插件和 MCP 管理。Token 与缓存指标来自各自运行时的 turn usage/context usage；缺失 Provider 指标时会明确显示不可用，不伪造零值。诊断、产物留存和更新入口位于设置中。

## Windows 安装与数据兼容

稳定安装器为 `Viniper-workstation-Setup.exe`，产品 AppId 为 `com.viniper.workstation`，默认用户级目录为 `%LOCALAPPDATA%\\Programs\\Viniper workstation`。1.6.x Stable 会独占租用既有 `%APPDATA%\\Viniper workstation Preview` Workstation 数据根，直接保留原有会话、SQLite、设置、记忆和安全存储；安装、卸载和回滚都不复制、清空、覆盖或删除该数据根。Preview 安装器仍作为上一版本回滚边界保留。

## 从旧 Viniper UI 的变化

旧 UI 的单一聊天入口现在明确拆成 Viniper Harness 与 Claude Code 两个 Agent；共享壳位置不改变，但每个 Agent 的状态、工具和权限 owner 可独立验证。新增了持久计划/目标、协作与子 Agent、项目索引/LSP、MCP/插件管理及可解释的 Token/缓存分区。

本次发布已在 Windows x64 上验证。macOS 构建和运行尚未验证（UNPROVEN）。
