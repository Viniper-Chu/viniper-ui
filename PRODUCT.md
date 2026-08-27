# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- 主要用户是在 Windows 上直接完成真实任务的人，包括不懂代码但需要简单 Agent 工作台的普通用户，以及依赖文件、终端、Git、审查和多任务协作的编程用户。
- 用户在一个长期运行的桌面工作区或 CLI 中创建独立会话、委派任务、查看执行状态，并在需要时控制权限、模型、记忆、自动任务与扩展。

## Product Purpose

Viniper Harness 是一个只做 Agent 的桌面 Harness。它把多模型推理、工具执行、会话隔离、跨会话协作、Token/缓存统计、调度、记忆、Skills/MCP/插件和编程工作区收进一个易理解的本地产品；成功意味着新用户不需要理解框架或命令行也能开始，高级用户仍能获得完整、可追溯的执行能力。

## Positioning

产品不是现有终端工具的套壳，也不以 Claude Code、Codex 或其他 Agent 框架作为运行内核。桌面端与 CLI 共享一个自主实现的 canonical Runtime、数据真源和权限/审计边界，并通过 Provider 适配层兼容主流模型 API。

## Operating Context

- Windows 11 是当前真实开发、打包和验收平台；macOS 同步维护设计草案，未有真机证据时保持 `UNPROVEN`。
- 用户围绕项目文件、终端命令、Git/worktree、Provider 配置、会话历史、Token/缓存、定时任务和扩展中心工作。
- 产品只访问用户明确打开或授权的本机范围；设备间通过用户主动导入导出迁移，不做账号、云端或局域网自动同步。

## Capabilities and Constraints

- 产品只有 Agent 模式，不保留 Chat/Agent 双状态机。
- 会话彼此隔离且可并行；同一会话支持多个独立 run，并可发送消息、委派和等待其他会话。
- 编程能力是必需能力，包括搜索/读取、可审查编辑、终端与构建测试、Git/worktree 和只读自动审查。
- 权限采用受限、项目完全访问和电脑完全访问层级；Harness 不得修改自身，审查层只报告不修复。
- 云端 API 是默认主路径，DeepSeek 优先；同时保留本地兼容端点与可选本地模型能力。模型价格不进入产品，只记录 Token、缓存、请求和耗时。
- 目标版本始终是 `0.0.1 Preview`，不是 Beta、公测、RC 或正式版。
- Windows 当前允许无管理员权限的用户级安装；不因此获得公开发布、签名、SmartScreen、远程更新或真实 Provider 验收结论。

## Brand Commitments

- 正式名称是 `Viniper Harness`。
- 主色调固定为巳月仙人模式意象的冷青、青绿及其邻近冷色，不改成紫色、暖橙或通用蓝。
- 品牌图标以清晰的 `V` 为主要元素；不使用动漫角色、其他产品标志或难辨识的复杂细节。
- 桌面体验参考 Codex、Claude Code 与 Viniper 的任务效率和信息结构，但形成自己的连续工作台，不复制任何产品的商标或界面。
- 文案使用直接、清楚的中文动作词；先呈现用户能理解的状态，再渐进披露 Provider、缓存、权限和运行时细节。

## Evidence on Hand

- 项目已有可运行的 Electron/TypeScript/HTML/CSS 桌面端、原生 CLI、P1–P4 编程闭环、原生 Tray、28 个 Provider profile 以及本地 fake/fixture 测试。
- Phase 7 视觉方案是本次重构的功能与缺陷证据，不再作为视觉权威；`D:\Viniper UI\source\viniper-ui` 只读用于功能与交互参考。
- 没有可用于产品内宣传的客户、价格、性能基准或公开发布证据，界面不得虚构这些事实。

## Product Principles

1. 先让人看懂当前任务、状态和下一步，再展示底层细节。
2. 功能完整不等于界面拥挤；高级能力通过一致导航和渐进披露出现。
3. 所有执行、权限、Token、工具和跨会话状态均可追溯且不会静默串线。
4. 桌面与 CLI 是同一 Harness 的两个入口，不是两套运行时。
5. Windows 结论必须来自真实运行证据；未验证的平台和外部能力如实标为 `UNPROVEN`。

## Accessibility & Inclusion

- 正文以 16px 为基准，不用低于 12px 的信息文字；窗口缩放和长中文内容不能造成遮挡。
- 核心操作支持键盘、清晰焦点和语义化控件；状态不能只靠颜色表达。
- 动效只解释状态并尊重 reduced motion；文本、图标、边界和交互态满足可读对比。
