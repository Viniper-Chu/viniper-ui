# Viniper workstation

这是 1.6.0 Stable 的本地 Windows Workstation 运行资源。Viniper Harness 与原生 Claude Code CLI 是两个独立 Agent：共享前端位置、控件和状态语义，但不共享 runtime、transport、会话、模型、权限、Skills/插件、MCP 或安全存储。

Viniper Harness 由 Application Port 驱动工具、附件、结构化 plan/goal、跨会话协作、委派和子 Agent；Claude code 只投影本机 Claude Code CLI 的原生事件和权限。ask/review/full 与 default/acceptEdits/plan 的映射分别由各自 owner 执行。

Windows Stable 安装器为 `Viniper-workstation-Setup.exe`，AppId 为 `com.viniper.workstation`，默认用户级目录为 `%LOCALAPPDATA%\\Programs\\Viniper workstation`。1.6.x Stable 继续租用 `%APPDATA%\\Viniper workstation Preview` 作为兼容数据根，不复制、清空或覆盖用户会话、SQLite、设置、记忆和凭据；Preview 构建与旧安装器仍是回滚边界。

运行资源还包含项目索引/LSP、代码导航、Skills、插件、MCP、Token/上下文与 Provider 缓存投影。Provider 密钥只通过 host-owned secret ref 读取，不写入 renderer、日志或仓库。Windows x64 已验证；macOS 尚未验证。
