# ADR-0081：DeepSeek 追加式缓存代际与稳定前缀

- 状态：Accepted
- 日期：2026-08-14
- 产品：Viniper Harness `0.0.1 Preview`

## 背景

v0.17 的真实 DeepSeek 连续会话中，工具续轮已有约 58%–59% 缓存命中，但跨 run 的短续聊仍为 0%。排查发现，Runtime 会在每次成功 run 后把 assistant 文本保存为自动会话记忆，下一次 run 又把这些自动记忆拼进 system/project 指令。Provider 已经在追加式历史里持有相同回答，因此这既重复内容，又从请求第 0 个 token 起改写前缀。

DeepSeek 上下文缓存按完全相同的请求前缀复用。上游 DeepSeek Harness 的可采纳结构是：稳定 header 与追加式 messages 分离；header 的工具、Skill、配置发生真实变化时才进入新的缓存代际。

## 决策

1. `ContextProfile` 继续是 Viniper 唯一缓存 header，不引入第二 Runtime 或上游 Cordis 内核。
2. 工具定义按 canonical name、Skill 按 id/name 固定排序；JSON 对象键递归排序。插件发现时序不得改变 Provider 可见前缀。
3. canonical Provider history 只追加，不把模型已给出的自动会话记忆再次注入 system/project header。自动记忆仍保存在记忆中心，用户可查看、停用或删除。
4. 用户明确创建的个人、项目和会话记忆仍可注入；CLI 的显式 `/memory-create session-auto` 记为 `user-explicit`，不与自动捕获混淆。
5. DeepSeek 工具调用回放使用空字符串 assistant content，并只在工具调用轮回填 `reasoning_content`，协议差异留在 OpenAI Chat 适配器。
6. DeepSeek V4 默认在约 96k 估算输入 token 前保持追加式历史；超过边界仍使用既有不可变摘要代际，不删除 canonical 历史。
7. 不通过静默裁短项目文件、网页或 Git 结果来制造高命中率。完整编程和网页能力优先；大输出继续使用已有显式范围/受管产物合同。

## 结果

- 相同能力集合的 Provider header 可字节稳定复用。
- 自动记忆仍是可见产品能力，但不再破坏缓存前缀或重复模型文本。
- Provider/model、工具、Skill、用户显式记忆、AGENTS.md 或摘要发生真实变化时允许自然进入新代际。
- 冷启动仍可能是 0%，且必须与暖运行分开报告。

## 验证门

- 离线：跨两个完成 run 的真实 Provider request header 相同，第二个 history 以第一个为前缀。
- 真实 DeepSeek：同一长会话中每个被计入的暖 run 均以 Provider usage 证明 `cacheHitInput / input >= 90%`。
- 工具：至少一轮真实代码工具调用完成，不能只测无工具问答。

