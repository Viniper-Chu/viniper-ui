# Viniper workstation 1.8.2 Stable

## 1.8.2 的主要改进

- DeepSeek 默认模型更新为 V4.1 Flash（API 名称 `deepseek-flash`）；官方部署的旧 Flash 别名自动兼容，Key 和自定义 Provider 保留。V4 Pro 仍为可选模型。
- 模型目录与迁移从 HTTP 服务拆出；上下文容量以服务端目录为准，前端不再重复维护容量表。
- 发送、重试、恢复共用流式传输模块；连接结束后核实后台运行状态，断线只恢复订阅，不重复发送任务。
- 输出重绘按会话合并；模型切换的过期用量响应不再覆盖当前模型。
- 后端回放使用有界环形缓冲，超出回放窗口时明确重读持久会话，不静默丢失中间输出。

Windows 通过完整安装程序升级，沿用已有数据目录。macOS 架构路径同步，但未进行真机验证。

Viniper workstation 是面向 Windows 的双 Agent 工作台。它保留熟悉的 Viniper 壳与浅青视觉，同时把两个运行时严格分开：

- **Viniper Harness**：自研 Harness Runtime/Application Port，负责 Viniper 会话、工具、权限、计划、目标、协作、跨会话消息与子 Agent。
- **Claude Code CLI**：只调用本机原生 Claude Code CLI；其会话、权限、任务/计划投影、Skills 与插件数据不复用 Harness。

两边使用相同的前端语义和位置（消息框、附件、模型、上下文环、Token、状态、设置层级），但不共享会话、运行时、模型、权限持久化或密钥。Viniper 提供每次询问、规划自动审核、完全访问；Claude Code 提供原生权限档位及完全访问，选择方向的问题仍由用户回答。

## 能力范围

工作台支持附件、结构化 plan/goal、任务委派与跨会话协作、受控子 Agent、真实工具/文件 diff、项目索引与代码导航、LSP、Skills、插件和 MCP 管理。Token 与缓存指标来自各自运行时的 turn usage/context usage；缺失 Provider 指标时会明确显示不可用，不伪造零值。诊断、产物留存和更新入口位于设置中。

## Windows 安装与数据兼容

稳定安装器为 `Viniper-workstation-Setup.exe`，产品 AppId 为 `com.viniper.workstation`，默认用户级目录为 `%LOCALAPPDATA%\\Programs\\Viniper workstation`。Stable 继续使用 `%APPDATA%\\Viniper workstation Preview` 兼容数据根，保留原有会话、SQLite、设置、记忆和安全存储。

在任一 Agent 的 **设置 → 应用更新 → 检查更新** 中检查 GitHub 正式版。发现新版本后，查看版本说明、下载安装包，再点击“安装更新”。桌面工作台会退出并打开安装器，按提示完成安装；下载失败可以重试，正在执行任务时不会自动退出。更新使用当前安装目录，不重置个人数据。首次安装或旧版本无法检查更新时，从 [GitHub Releases](https://github.com/Viniper-Chu/viniper-ui/releases/latest) 下载完整安装包。

运行需要本机 Node.js、Python 及 PowerShell 7；Claude Code 还需安装原生 CLI，并在其独立设置中配置可用的兼容 Provider。发行包不包含个人凭据，第三方用户应填写自己的配置。

## 1.8.1 的主要改进

- 应用内完整安装包更新、真实下载进度、失败重试和活动任务保护。
- 独立的双 Agent 设置与模型管理，修复切换 Agent 时的迟到响应、草稿与工作区串页。
- Claude Code 原生初始化、命令发现、权限确认和会话恢复；深层 Windows 路径下权限交互不再误报 CLI 未安装。
- 原生子 Agent 输出保留在工具记录内，不混入主回答；官方 DeepSeek 主模型和子模型映射独立配置。
- Viniper 实时输出、取消、审批等待和工具进度反馈；计划不会把尚未验证的步骤标为完成。
- 浅青色设置排版与正确的 Windows 应用、任务栏及托盘品牌图标。

当前边界：Viniper 运行中续发是排队，不是实时引导；部分 Claude Code 交互式命令打开原生终端。更新失败时保留当前版本，不承诺网络、Provider 或所有长任务均无故障。

## 从旧 Viniper UI 的变化

旧 UI 的单一聊天入口现在明确拆成 Viniper Harness 与 Claude Code 两个 Agent；共享壳位置不改变，但每个 Agent 的状态、工具和权限 owner 可独立验证。新增了持久计划/目标、协作与子 Agent、项目索引/LSP、MCP/插件管理及可解释的 Token/缓存分区。

本次发布已在 Windows x64 上验证。macOS 构建和运行尚未验证（UNPROVEN）。
