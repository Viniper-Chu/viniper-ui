# ADR-0004：多 Provider 协议族、结构化工具续轮与缓存策略

- 状态：Accepted
- 日期：2026-08-12
- 产品：Agent Desktop `v0.0.1 · Preview（预览版）`

## 背景

Phase 2 已建立 Provider-neutral 流事件、DeepSeek 本地 fake、Token 账本、safeStorage 和多会话运行时，但请求仍只携带当前文本与扁平稳定前缀；工具调用也只投影为可见卡片，尚未形成“模型请求工具 → 本地权限与执行 → 工具结果回传 → 模型最终回答”的完整 Agent 循环。

用户要求适配 GPT、Claude、Grok、Gemini 与国内主流公开文本 API。各厂商即使声称兼容同一种接口，在 SSE 事件、thinking、工具调用 ID、续轮方式、usage、缓存参数、模型发现和鉴权上仍有差异。

## 决策

### 1. Profile 与 Protocol 分离

Provider profile 只声明厂商事实：协议族、端点、鉴权、模型发现、能力、缓存策略、证据等级和第一方资料。Protocol adapter 负责请求序列化、SSE 解析、续轮数据以及 usage/error 映射。

首批协议族固定为 OpenAI Responses、Anthropic Messages、Gemini Interactions、OpenAI Chat Completions 和 SenseNova 自定义封装。增加厂商时优先增加 profile；只有线上格式确实不同才增加协议族。

### 2. Runtime 拥有工具循环

Provider 只产出结构化 tool call。Agent Runtime 统一处理参数校验、权限门、ToolRegistry 执行、canonical 事件、tool result 和续轮。Provider 适配器不得直接执行本地工具，也不能绕过权限和审计。

### 3. 保存结构化历史

会话历史保存 user、assistant、tool call、tool result 以及协议续轮所需的 reasoning/continuation item，不再拼成一段文本。core 不暴露厂商原始请求体，但必须原样保存 call id / tool use id 等关联标识。

### 4. 缓存是协议和模型策略

ContextProfile 保持“工具定义 → system/instructions → 项目上下文 → Skills → 稳定历史 → 当前动态输入”的顺序，CachePolicy 决定投射方式：

- OpenAI GPT-5.6 及后续家族使用稳定语义 key、显式 breakpoint 和相应 cache options；更早模型不强塞新参数。
- Claude 使用稳定 tools → system → messages，并按 automatic 或显式 `cache_control` 记录 creation/read。
- xAI 使用稳定会话/缓存 key 与追加式前缀。
- Gemini Interactions 使用隐式缓存；ADR-0049 已将产品语义细化为 `server_state=off` 默认关闭并使用本地历史，只有具体 profile 显式开启且端点支持时才使用服务端状态。`store=false` 只在真实协议支持时投射，不向其他端点发送虚构字段。
- 国内厂商只启用第一方文档明确的字段；没有数据时显示未知，不把 0 冒充确认结果。

缓存 key 使用 provider、model、profile generation、tool schema version 等可读稳定字段。

### 5. 证据等级进入产品

Profile capability 分为 `officially-documented`、`profile-dependent`、`manual-unconfirmed`。本地 fake 通过只证明 serializer/parser/loop 合同；真实网络调用前统一显示 `REAL_API_UNPROVEN`。模型发现不存在时允许手工 model ID，不用过期别名伪装动态发现。

### 6. 秘密只在主进程

每个 profile 的 API Key 和额外鉴权字段进入 SecretVault。Renderer 仅能写入、删除和查询 `configured`；HTTP 客户端在主进程临时读取。base URL、模型 ID 与非秘密能力开关可以进入普通 settings，密钥和签名材料不可以。

## 后果

### 收益

- 二十多个厂商共享五个协议族，减少重复和长期维护成本。
- 原生 tools、thinking、usage 与缓存语义可以保留。
- 所有 Provider 共用同一套本地权限、执行和审计路径。
- UI 能明确区分“协议已映射”与“真实凭据已验收”。

### 代价

- core 合同和测试夹具比纯文本客户端复杂。
- 同一厂商随模型、地域或账户可能有能力差异，需要 profile 覆写和手工模型选项。
- 没有新鲜凭据时只能完成本地合同，不能证明真实账户、区域、权限、余额、缓存命中和计费。

## 否决方案

- 每家厂商复制完整 Provider：重复 serializer/parser/error/tool loop，长期不可维护。
- 所有厂商都走 OpenAI Chat：会丢失 Responses、Anthropic 与 Gemini 的原生续轮和缓存语义。
- 只做自定义兼容入口：对初学者过于复杂，也无法表达官方能力差异。
- 使用用户曾粘贴在会话里的凭据：不符合应用内 SecretField 的输入边界，也不应进入构建、测试或日志。

## 验证

每个协议族一个本地 fake 工具闭环；每个 profile 一个 serializer/auth/capability 合同；完整 Phase 1/2 回归；Windows 大窗与 960×720 真窗口；项目静态凭据命中文件数为 0；公网 Provider 请求数为 0。macOS 和所有真实 Provider 继续保持 `UNPROVEN`。
