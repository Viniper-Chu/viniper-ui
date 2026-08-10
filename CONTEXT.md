# Viniper Agent Desktop

Viniper 是 Windows 桌面上的本地 Chat 与 Agent 工作区。桌面壳保存用户会话与设置，Agent 任务由受管 Claude Code 运行环境执行并把结构化状态呈现在同一界面中。

## Language

**Chat Session**:
只传递用户与助手文本、不会启动 Claude Code 或授予工作目录能力的会话。
_Avoid_: 首页会话、普通模式

**Agent Session**:
拥有独立上下文、工作目录、Claude Code 进程与交互状态的任务会话。
_Avoid_: Agent 实例、代码页

**Agent Runtime**:
执行 Agent Session 的受管运行环境；负责平台能力、路径、Claude Code 进程与生命周期。
_Avoid_: CLI 启动器、Shell 包装

**WSL Runtime**:
Viniper 在 Windows 上用于执行 Agent Runtime 的 WSL2 Linux 发行版与工具链。
_Avoid_: 虚拟机、默认 Ubuntu

**Runtime Provisioning**:
把 WSL Runtime 从未安装、待重启或缺少 Claude Code 转为可执行状态的可恢复流程。
_Avoid_: 静默安装、依赖修复脚本

**Runtime Update**:
随 Viniper 版本更新检查并更新 WSL Runtime 内 Claude Code，验证兼容后才启用新版本的流程。
_Avoid_: 自动 npm 更新、应用热更新

**Peer Message**:
一个 Agent Session 先通过 Claude Code 原生 `ListAgents` 确认重叠活动的目标地址，再通过原生 `SendMessage` 发出的纯文本消息；它不携带会话历史、文件或用户授权。
_Avoid_: 会话转移、共享上下文、用户消息

**Agent View Session**:
`claude agents --json` 返回的前台/后台 Claude 生命周期行；用于观察 id、state、cwd、kind 等运行状态，不是跨会话 peer 地址真源。
_Avoid_: Peer Registry、ListAgents 结果

**Peer Capability**:
当前受管 CLI、Provider 与 feature flag 组合在结构化 init 中同时明确提供 `ListAgents` 和 `SendMessage` 的能力证据；未满足时跨会话入口完全不渲染。
_Avoid_: 禁用占位按钮、Agent View 推断

**Usage Snapshot**:
某个 Agent Session 最近一次由 Claude Code 返回的上下文 token 用量、上限、比例和来源。
_Avoid_: 字符估算、用量动画

**Skill Source**:
包含官方顶层 `<skill-name>/SKILL.md` 的原始本地目录；目录 slug 是 `/command` 真源，frontmatter `name` 是原始展示名。
_Avoid_: 深层副本扫描、中文展示名作为命令

**Claude Skill Bridge**:
Viniper 受管的 WSL `--add-dir` 目录，通过 Linux symlink 让 Claude Code 发现兼容 Skill Source；不复制技能、不覆盖用户个人同名技能。
_Avoid_: 技能商店、用户技能迁移、UI 可见即 CLI 可用

**Skill Display Metadata**:
在不改变技能 id、路径、来源、命令和原始标题的前提下，供简体中文界面使用的 `display_*` 字段。
_Avoid_: 翻译后的机器标识、猜测性功能翻译

**Preview**:
与正式版安装、快捷方式、数据和进程完全隔离的可运行验收版本。
_Avoid_: 测试版覆盖、正式候选
