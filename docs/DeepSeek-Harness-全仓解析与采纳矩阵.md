# DeepSeek Harness 全仓解析与 Viniper 采纳矩阵

日期：2026-08-14

上游：`deepseek-ai/deepseek-harness` 官方 GitHub 仓库

Viniper 阶段：`0.0.1 Preview`

## 读取证据

- 只读副本：`D:\Agent\codex\运行残留\DeepSeek-Harness-Upstream`
- 清单与统计：`D:\Agent\codex\工作输出\DeepSeek-Harness-全仓解析\all-files.jsonl`、`summary.json`
- 实际打开：7,412 / 7,412 文件，47,679,644 bytes。
- 文本：7,396；二进制：16。实现文件 1,752，测试/fixture 1,733，文档 3,024，配置/支持 895。
- 上游 packages 共 47 个一级组、219 个子包，覆盖 core、preset/bundle、extensions、workflow、subagent、code-runtime、LSP、Skill、hooks、session、compaction、permissions/sandbox、Provider 与 client。
- 本记录不列文件内容摘要值，不运行上游，不把它的测试结果当作 Viniper 结果。

## “插件任意排列组合”到底是什么

它不是“任何插件随便堆在一起都能跑”。准确含义是：每项能力先声明自己提供什么、依赖什么、在哪个作用域生效、何时加载和如何卸载；运行时再按 profile/preset 组合成一棵插件树。注册产生 disposer，卸载时撤销对应 effect；事件与服务由作用域决定可见范围。

Viniper 会把工程化概念翻译为“能力方案”：

- 用户选择需要的能力，如编程、网页、办公、研究、工作流、Skill、MCP、插件。
- 系统自动检查依赖、冲突、信任、权限、平台和顺序。
- 能组合的形成预览；不能组合的给出人话原因，不带病运行。
- 任务开始后冻结，插件更新只影响下一个任务。

## 总体采纳矩阵

| 上游能力 | 判断 | Viniper 落点 | 关键改写 |
| --- | --- | --- | --- |
| Plugin tree / scope / inject / effect | 采纳思想 | `features/composition` | 不引入 Cordis；使用显式定义、作用域和 disposer |
| Preset / bundle / profile | 采纳 | 能力方案中心 | 改为通用增强、DeepSeek 高效、轻量、自定义；不暴露包树 |
| Agent scoped runtime | 融合 | 单一 Runtime 下的 session/run scope | 不复制 Runtime；runId 是权威边界 |
| Typed lifecycle events | 采纳 | `features/lifecycle` | 进入 canonical event；拦截器有顺序、来源和撤销 |
| Tool execution pipeline | 深化已有 | ToolRegistry/AgentToolLoop | pre -> permission/guard -> execute -> post -> result；保持一次批准与审计 |
| Tool presentation native/code/both | 采纳 | `features/code-runtime` | 增加 `run_code`，SDK 只映射冻结工具 |
| Worker-thread Code Mode | 采纳 | Windows/Node worker | 一次性执行、限制输出、取消排空；不是安全沙箱 |
| Skill registry / progressive load | 深化已有 | SkillCatalog | 多来源分层、按会话启用、run 冻结与失效说明 |
| Extensions / reversible registration | 深化已有 | ExtensionManager | 安装/信任/运行权限分离，current/previous 与旧 run 冻结 |
| Hooks | 有条件采纳 | 生命周期兼容适配器 | 只能走受管进程和窄事件，不能改核心状态 |
| steer / inject inbox | 采纳 | `features/steering` | 运行中追加指令、非唤醒上下文、排队/交付回执 |
| Workflow | 采纳 | `features/workflows` | 串联、路由、并行、编排者、评估优化均调度 canonical run |
| Subagent providers | 深化已有 | CoordinationService | 隔离上下文、能力/权限快照、全局容量、显式结果回执 |
| LSP seam | 采纳 | `features/lsp` | 只读四操作；可用 provider + 项目索引回退 |
| Append-only session/event log | 已有并深化 | SQLite canonical events | 事件真源、投影分离、step/tool 生命周期可重建 |
| Compaction / tool pruning / spill | 已有并深化 | context-compaction/tool-output | 原历史不删、摘要 generation 不变、完整输出在受管文件 |
| Provider adapter registry | 已有 | ProviderRegistry | 保持五协议族、28 profile、DeepSeek 优先与缓存差异 |
| Permission/sandbox | 融合 | PermissionPolicy/受管子进程 | 权限是真边界；worker/子进程故障隔离不夸称 OS 沙箱 |
| Runtime client/host | 已有 | desktop/CLI application port | 单一 owner + IPC，不复制写者 |
| Creator/Cordis self modification | 拒绝 | 仅“下次运行草案” | 禁止模型改自身、源码、权限、系统指令和当前 run |
| 上游 UI / branding | 拒绝复制 | Cyan Plotter Rail | 保持 Viniper 冷青一体化界面、V 品牌与低文字按钮 |

## 最有价值的六项增量

1. **能力组合编译器**：把工具、Skill、插件、工作流、模型能力变成可检查的组合，而不是散落开关。
2. **FrozenRunContext**：一次冻结 Provider、工具、Skill、扩展、权限与缓存身份，解决热更新和恢复漂移。
3. **生命周期拦截器**：把权限、审计、诊断、Hook、结果整形接到明确阶段，不让插件绕过核心。
4. **Code Mode**：模型可一次生成短程序批量调用工具，适合 DeepSeek 处理大量可组合能力，同时每个动作仍受权限控制。
5. **steer/inject + workflow/subagent**：运行中追加方向、投递非唤醒上下文，并把五种常见流程模式落到同一 run 调度器。
6. **窄 LSP**：编程任务从纯文本搜索升级到定义、引用、实现、悬停信息，但不开放任意协议调用。

## 对普通用户的最终表现

- 默认直接交任务，不需要懂插件树。
- “能力方案”页显示本次 Agent 会什么、为什么、缺什么；可复制为自定义方案。
- DeepSeek 优先时默认推荐“DeepSeek 高效”，但 GPT、Claude、Gemini、Grok 和国内 Provider 仍共享同一组合能力。
- 编程能力始终保留；轻量方案只是减少非必要模块，不移除项目读写、终端、Git 和审查的可选入口。
- 模型问“你是什么”仍只回答“我是 Viniper Harness”；DeepSeek 是推理 Provider，不是产品身份。

## 证据等级

- `PASS`：全仓读取与架构分类完成。
- `AUTHORIZED / NOT_YET_IMPLEMENTED`：ADR-0080 与 v0.14 已授权实施。
- `UNPROVEN`：新组合能力尚需离线测试、真实 DeepSeek 任务与 Windows 正式安装验收；macOS 继续 draft-only。

## v0.18 缓存代际采纳（2026-08-14）

- 采纳上游“稳定 EpochHeader + append-only messages”的结构，不引入上游运行内核：Viniper 的 `ContextProfile/FrozenRunContext` 是稳定 header，canonical Provider history 是追加式消息。
- 根因修复不是“多发几次请求”：自动 assistant 会话记忆仍保存给用户查看，但不再重复注入下一次 system/project 前缀；用户显式保存的记忆仍然有效。
- 工具 schema、Skill 和 JSON 对象键使用 canonical 顺序，插件发现/注册时序不再产生无意义缓存代际。
- DeepSeek 工具轮的 assistant 空内容与 reasoning 回填保持在 OpenAI Chat 适配器；V4 长上下文在接近容量前保持追加式历史，再进入不可变摘要 generation。
- 明确拒绝用不可续读的短预览裁掉项目文件、网页或 Git 正文来换命中率；编程和网页能力不降级，完整输出继续走现有范围/产物合同。
- 真实 Provider 证据：冷轮 0% 单列；暖续聊 98.76%；包含 `terminal.run` 的暖代码轮 99.47%。所有被计入暖门槛的 run 均大于 90%。
