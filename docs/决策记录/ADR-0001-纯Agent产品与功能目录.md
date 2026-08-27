# ADR-0001：纯 Agent 产品与功能目录

状态：Accepted
日期：2026-08-12
决策人：用户 / Agent Desktop 管理层

## 背景

Phase 1 v0.1 原计划同时提供 Chat 与 Agent。用户随后明确要求“不用 Chat 模式，只做 Agent”，并要求所有 Agent 功能分门别类、使用 Git 管理，便于追溯和修改。

## 决策

1. 产品只保留 Agent 工作区，不提供 Chat/Agent 模式切换。
2. 普通问答仍在 Agent 会话中完成；工具是否被请求、是否允许执行，由 Agent Runtime、工具合同和权限状态决定。
3. 领域合同移除 `SessionMode` 和 intent 中的 `mode`。不得保留一套隐藏 Chat 状态机。
4. 代码采用 `core + features + platform + renderer` 结构。功能域至少覆盖 sessions、runs、queue、permissions、tools、providers、cache、settings；Renderer 按 shell、sessions、conversation、composer、activity、settings、styles 分组。
5. Git 保留 v0.1 文档作为历史，新增 v0.2 合同。实现按“需求与骨架 / 纯 Agent 运行纵切 / 验证与文档”形成逻辑提交，不上传远端，不在报告中写提交哈希。

## 影响

- 用户少一个模式概念，首次使用路径缩短。
- Chat 禁工具测试被“单一 Agent Runtime + 权限边界”测试替代。
- Viniper 的普通对话体验保留，但 Chat/Agent 切换本身不再属于最终 MUST。
- 功能域目录增加少量入口文件，但降低后续新增真实 Provider、权限卡、技能和工具时修改巨大文件的风险。

## 非目标

- 不做一函数一文件夹。
- 不在本轮接入真实模型、密钥、任意 shell 或写文件工具。
- 不因目录调整把 Phase 1 扩大为 Viniper 全功能实现。
