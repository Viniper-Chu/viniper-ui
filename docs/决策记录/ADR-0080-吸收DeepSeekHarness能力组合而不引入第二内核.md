# ADR-0080：吸收 DeepSeek Harness 能力组合而不引入第二内核

日期：2026-08-14

状态：Accepted

产品版本：Viniper Harness `v0.0.1 · Preview`

## 背景

用户要求完整阅读官方 `deepseek-ai/deepseek-harness`，把其中优秀能力吸收到 Viniper Harness，并继续满足既有桌面、CLI、权限、编程、多会话、Token/cache、调度、Skills/MCP/插件、DeepSeek 优先、禁止模型修改自身及 Windows 用户级安装要求。

管理层已对上游浅克隆副本逐文件读取：共 7,412 个文件、47,679,644 bytes；其中 7,396 个文本文件按字符读取、16 个二进制文件按字节读取。上游是开发者预览，采用插件树与 Cordis 组合机制；这份读取证明只说明资料覆盖，不把上游运行结果或兼容承诺外推为 Viniper 事实。

## 决策

Viniper 采用“能力组合计划”，不采用上游框架作为运行时依赖：

1. 保持一个 Runtime owner、一个 SQLite 结构化真源、一个 ToolRegistry、一个权限与审计真源；桌面、CLI、调度和子 Agent 都通过同一 application port。
2. 引入 `CapabilityDefinition -> CapabilityProvider -> CapabilityConsumer` 三段能力契约，以及带 disposer 的可逆注册；贡献可来自内置模块、Skill、MCP、受管插件或用户自定义能力方案。
3. 组合编译器接收能力、依赖、冲突、作用域、顺序和呈现方式，产出不可变 `CompositionPlan`。所谓“任意组合”只指在合同允许范围内自由选配；缺依赖、发生冲突、权限不足或宿主不兼容时必须明确阻止并解释。
4. 每个 run 开始时建立 `FrozenRunContext`，固定 Provider/model、能力方案 revision、工具 schema、Skill 正文、扩展版本、权限/审查、项目指令、缓存前缀与恢复信息。正在运行的任务不接受热更新偷换。
5. 提供 `standard / deepseek-efficient / minimal / custom` 方案。默认仍是通用 Agent，编程能力是一等能力；DeepSeek 高效方案增加 Code Mode 与批量工具编排，不把产品降成只会聊天或只会终端。
6. 生命周期扩展通过 typed events 与窄拦截器进入；兼容 Hook 只是适配层，不能直接改 SQLite、历史、ToolRegistry 或权限决定。
7. Code Mode 在受管 worker 中执行一次性 TypeScript/JavaScript 程序；程序只能通过生成的工具 SDK 访问本 run 已冻结工具。每个子调用仍经过输入校验、PermissionPolicy、资源锁、完整工具流水线、artifact 与审计。worker 隔离不是权限边界。
8. LSP 仅暴露 definition、references、implementation、hover 四个只读动作；不提供通用 JSON-RPC 逃生口。无可用语言服务时明确回退到现有项目符号/词法索引。
9. 工作流与子 Agent 复用现有 run、全局并发、CoordinationService、权限和 Token 账本；不得创建第二 Agent loop 或第二持久化真源。
10. 不吸收运行时自我修改。能力方案的新增/变更只能形成“下次运行草案”，由用户确认后进入新 revision；模型不能改 Harness 源码、系统边界、权限规则、凭据或当前 run。

## 采纳层级

### 直接重写为 Viniper 原生能力

- 插件化能力组合、作用域、依赖注入、冲突与可逆注册。
- Agent/step/tool 生命周期事件与可拦截流水线。
- run 冻结上下文、append-only 事件与投影视图分离。
- Code Mode 的生成 SDK、批量/并行子调用与原生权限回流。
- Skill 分层目录、渐进加载、按会话启用与失效通知。
- 窄 LSP、workflow、subagent、steer/inject、compaction/spill 接缝。

### 融合到已有模块

- 上游 session/storage/compaction/approval/provider/extension 思路分别并入 Viniper 已有 SQLite、会话投影、ContextCompactionService、PermissionPolicy、ProviderRegistry 与 ExtensionManager，不新建重复模块。
- 上游 profile/bundle 的优点改写成普通用户能理解的“能力方案”，不暴露复杂包树。

### 明确不采纳

- Cordis 或任何第三方 Agent 框架作为 Viniper 运行内核。
- 运行时自我修改、自动写回 Harness 配置、自动安装未知代码。
- 原始 JSONL 作为权威数据真源、无边界任意 shell、通用 JSON-RPC 逃生口。
- 复制上游桌面界面、品牌、CLI 文案或把 DeepSeek 模型品牌当作 Viniper 身份。

## 版权与来源

本项目以独立实现吸收架构思想，不整包复制上游代码。若后续确需采用上游具体源码片段，必须保留对应 MIT 许可与来源，并单独核对第三方通知；不能因主仓库 MIT 就把其第三方依赖一并视为可随意复制。

## 后果

- 优点：能力可以组合但仍可解释、可审计、可冻结；DeepSeek 面对大量工具时可通过 Code Mode 降低工具轮次和 schema 噪声；桌面与 CLI 共享同一事实。
- 代价：组合编译、冻结快照、Code Mode worker、生命周期拦截和 UI 解释层都需要直接消费者与恢复测试；开发者预览上游后续变化不自动进入 Viniper。
- 验收：以 v0.14 合同的离线测试、真实 DeepSeek 产品链和正式安装证据为准，不用“读过上游”替代产品 PASS。
