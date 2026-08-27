# ADR-0069：共享协议族打底，并以 DeepSeek 作为首个实用化优先级

- 状态：Accepted
- 日期：2026-08-13
- 决策人：用户 / Viniper Harness 管理层
- 适用版本：`v0.0.1 Preview`

## 背景

逐厂商复制适配器会扩大维护成本；只完成抽象而不优先跑通用户实际使用的模型，又会得到“兼容表很全、日常不可用”的产品。用户选择方案 C，并明确补充以 DeepSeek 优先，因为其将作为当前主要使用模型。

## 决策

- 继续以五个协议族作为复用真源：OpenAI Responses、Anthropic Messages、Gemini Interactions、OpenAI Chat Completions、SenseNova 封装。
- Provider profile 只表达端点、鉴权、模型、能力和少量厂商差异，不复制 Agent Runtime、工具循环、权限或历史。
- 每条新工具与运行能力都先通过协议族本地 fake 回归，再以 DeepSeek 完成首个真实产品链验收；DeepSeek 的高优先级不允许把专属字段泄漏到其他协议族。
- DeepSeek 当前走 OpenAI Chat Completions 边界，保持工具名投射、thinking/reasoning 续轮、每会话 `user_id` 和 Provider usage/cache 对账。
- GPT、Claude、Grok、Gemini 以及国内其他主流 profile 继续保留本地合同和后续真实验收入口，不因 DeepSeek 优先而删除或降为静态名单。

## 收益

- 用户当前最需要的 DeepSeek 能力能最快进入真实可用状态。
- 公共协议能力仍能自然复用于其他厂商，避免形成 DeepSeek 专用 Harness。

## 代价

- 其他 Provider 在取得各自真实凭据前仍只能标为本地合同通过或未证明。
- DeepSeek 的真实问题必须在适配边界修复，不能用修改公共消息语义的捷径处理。

## 与既有决策的关系

- 细化 ADR-0004 的协议族方案和 API 适配矩阵的实施优先级。
- 不改变“没有对应用户凭据就不发网”与逐 Provider 独立证据原则。

