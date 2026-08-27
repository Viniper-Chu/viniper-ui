# Viniper Harness v0.0.1 Preview API 适配矩阵

- 调研日期：2026-08-13
- 适用合同：`docs/任务合同-v0.9-P1纵向闭环与Windows便携版.md`
- 状态含义：`官网已确认` 只表示协议、鉴权或端点能由第一方资料核对，不表示已经使用真实账户调用。
- 真实连接状态：DeepSeek `deepseek-v4-flash` 已在 Phase 5 通过真实 Windows 产品链；Phase 6 获得一次新的有界复验授权。其余 Provider 仍为 `LOCAL_CONTRACT_PASS / REAL_API_UNPROVEN`，必须逐家使用对应凭据独立验收。

## 纳入标准

本矩阵覆盖当前能找到第一方公开通用文本生成 API 的主流厂商与聚合平台。某家只提供网页产品、只有第三方转售页面、只提供图像/视频接口，或没有足够明确的当前公共端点时，不把它伪装为已适配。

“国内主流”在本预览版中的可执行定义是：下表列出的 23 个当前第一方公开文本 API 档案，加一个自定义兼容入口。它不是对中国所有模型品牌永久封闭的名单；目录可以只增加 profile，不必重写运行时。

## 共享协议族

| 协议族 | 主要对象 | 公共实现责任 |
| --- | --- | --- |
| OpenAI Responses | OpenAI、xAI、百炼、方舟、千帆、小米、360 | typed SSE、结构化 output item、function call/result、continuation、usage/cache 映射 |
| Anthropic Messages | Claude、MiniMax、LongCat、蚂蚁百灵；腾讯 TokenHub 可选 | message/content block SSE、thinking、tool_use/tool_result、cache_control、usage |
| Gemini Interactions | Gemini | step SSE、function_call/function_result、可选 previous interaction、implicit cache、usage |
| OpenAI Chat Completions | DeepSeek、GLM、Kimi、StepFun、星火、华为、百川、Yi、硅基流动、魔搭、元景、TeleChat、JoyBuilder 等 | role/tool 历史、SSE delta、reasoning、tool_calls、usage |
| SenseNova 自定义封装 | 商汤日日新 | 自定义 data 包、SSE、usage；未确认能力保持关闭 |

公共运行时必须传结构化历史和工具结果，不能把历史压成一段字符串。工具循环由 Agent Runtime 执行；适配器只负责请求投射、流解析、续轮数据和 usage/error 映射。

实施顺序按 ADR-0069：五个协议族始终保持本地 fake 与回归，但 DeepSeek 是首个真实实用化优先级。DeepSeek 专属的工具名、thinking/reasoning、`user_id` 和 usage/cache 只留在 OpenAI Chat/DeepSeek 边界，不能改变其他协议族的 canonical 消息。

## 模型目录刷新合同

- 对提供权威模型列表接口的 Provider/profile，在启用或 Runtime 启动后刷新，并在最近一次成功刷新后每 24 小时自动刷新；用户可以随时手动刷新。
- 只有鉴权成功、响应完整且能按当前 profile 合同解析的列表才可替换本地目录。网络、鉴权、限流或解析失败只显示“刷新失败”和最近成功时间，不得把失败响应当作空列表。
- 成功目录中消失的模型立即从新会话选择器和智能分配候选中移除；正在运行的冻结模型快照与历史记录不改写。旧会话下次运行前显示 `model_unavailable` 并要求用户另选模型，不做静默换模。
- 没有模型发现接口的自定义兼容入口继续使用用户手工填写的模型，直到用户明确删除；不得用另一家 Provider 的公共目录推断其可用模型。
- 以上是 ADR-0053 的目标合同，尚无真实账号目录刷新、消失模型或跨平台证据，状态为 `UNPROVEN`。

## 云端主路径、本地模型与价格边界

- 云端 API 是默认接入与新建会话主路径。ADR-0058 另提供两种可选本地接入：用户已有的 OpenAI-compatible 本地端点，以及用户明确下载后由 Viniper 管理的本地模型运行器。
- 主安装包不附带模型权重，启动和云端请求失败都不会自动下载、启动或切换本地模型。本地运行器只监听本机回环地址，并通过同一 ProviderAdapter、ToolRegistry、权限、Token、取消和审查合同工作。
- 受管模型可以从内置已知来源、本地文件或自定义来源取得；获取前显示来源、许可、体积、格式和已知兼容信息。更新只提醒，下载和版本切换都由用户确认，旧版本保留到主动删除。
- 本地模型只有在实际能力合同证明后才能开启 stream、reasoning 或结构化输出；工具能力分别标记 `native / experimental_emulation / none`。实验模拟必须按模型明确启用，解析后的调用仍经过统一 ToolRegistry、参数校验、权限和审计，不能因为兼容 Chat 文本接口就标成完整 Agent 能力。
- 本地推理默认同时 1 路；Runtime 根据模型与本机资源给出建议，用户可提高但不超过全局并发上限，桌面端与 CLI 共用名额。
- 按 ADR-0059，所有云端与本地 profile 都不维护单价、币种、金额、费用估算或余额。usage 只记录 Token、缓存、请求和耗时，用户自行到 Provider 官网查询价格和账单。
- 内置本地运行器、模型下载、硬件适配与真实能力均为 `UNPROVEN`；本节不把本地 fake 端点冒充本地推理支持。
- 按 ADR-0070，本地模型生产实现排在云端纵向闭环和首批编程能力之后；当前阶段不下载权重、不引入运行器，也不删除上述目标设计。

## 国外模型（用户指定四家）

| Provider | 首选协议 / 端点 | 缓存与续轮规则 | 第一方资料 | 状态 |
| --- | --- | --- | --- | --- |
| OpenAI GPT | Responses `https://api.openai.com/v1/responses` | GPT-5.6 及后续家族使用稳定 `prompt_cache_key`，可在稳定前缀末端设显式 `prompt_cache_breakpoint`；更早模型继续走其自动缓存规则；映射 `cached_tokens` 与 `cache_write_tokens` | https://developers.openai.com/api/docs/guides/prompt-caching ; https://developers.openai.com/api/docs/guides/function-calling | 官网已确认 |
| Anthropic Claude | Messages `https://api.anthropic.com/v1/messages` | automatic 或显式 `cache_control`；保持 tools → system → messages；支持 5 分钟/1 小时策略；映射 cache creation/read | https://platform.claude.com/docs/en/build-with-claude/streaming ; https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works ; https://platform.claude.com/docs/en/build-with-claude/prompt-caching | 官网已确认 |
| xAI Grok | Responses `https://api.x.ai/v1/responses` | 自动前缀缓存；保持稳定 `x-grok-conv-id` 与 `prompt_cache_key`；工具结果按原 call id 续轮 | https://docs.x.ai/developers/advanced-api-usage/prompt-caching ; https://docs.x.ai/developers/tools/function-calling | 官网已确认 |
| Google Gemini | Interactions `https://generativelanguage.googleapis.com/v1/interactions` | Interactions 使用隐式缓存；按 ADR-0049 默认采用本地历史模式，只有用户在具体 profile 明确开启后才使用服务端交互状态。`store=false` 仅在当前端点真实支持时映射，不向其他端点发送虚构字段 | https://ai.google.dev/gemini-api/docs/interactions-overview ; https://ai.google.dev/gemini-api/docs/streaming ; https://ai.google.dev/gemini-api/docs/function-calling ; https://ai.google.dev/gemini-api/docs/caching | 官网资料基线已确认；真实状态/保留/删除仍未验证 |

## 国内模型与平台

| Provider / Profile | 首选协议 / 端点 | 能力与边界 | 第一方资料 | 状态 |
| --- | --- | --- | --- | --- |
| DeepSeek | Chat `https://api.deepseek.com/chat/completions` | SSE、thinking/reasoning、tool calls、usage、上下文缓存命中/未命中；模型 ID 从模型接口或手工选择 | https://api-docs.deepseek.com/api/create-chat-completion ; https://api-docs.deepseek.com/guides/tool_calls ; https://api-docs.deepseek.com/api/list-models | `deepseek-v4-flash` Phase 5 真实产品链 PASS；Phase 6 待有界复验 |
| 阿里云百炼 / Qwen | Responses；地域端点由账号选择 | previous response、function call、SSE、reasoning/cache usage；端点不硬编码为单一区域 | https://help.aliyun.com/en/model-studio/qwen-api-via-openai-responses ; https://help.aliyun.com/en/model-studio/context-cache | 官网已确认 |
| 火山引擎方舟 / 豆包 | Responses `https://ark.cn-beijing.volces.com/api/v3/responses` | SSE、工具续轮、上下文缓存；推理接入点由控制台决定 | https://www.volcengine.com/docs/82379/1795150 ; https://www.volcengine.com/docs/82379/1958524 ; https://www.volcengine.com/docs/82379/1528788 | 官网已确认 |
| 腾讯云 TokenHub / 混元 | TokenHub Responses 或 Anthropic；Chat 备用 | tools、thinking、cache usage；旧混元协议仅作兼容迁移 | https://cloud.tencent.com/document/product/1823/132252 ; https://cloud.tencent.com/document/product/1823/130079 | 官网已确认 |
| 百度千帆 / 文心 | Responses `https://qianfan.baidubce.com/v2/responses` | tools、previous response、reasoning/usage；Chat 作为备用 | https://cloud.baidu.com/doc/qianfan-docs/s/4mi400l1m | 官网已确认 |
| 智谱 GLM | Chat `https://open.bigmodel.cn/api/paas/v4/chat/completions` | SSE、tools、reasoning、cached usage | https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8 | 官网已确认 |
| 月之暗面 Kimi | Chat `https://api.moonshot.cn/v1/chat/completions` | SSE、tools、reasoning、cached usage、`prompt_cache_key`；稳定会话标识 | https://platform.kimi.com/docs/api/chat | 官网已确认 |
| MiniMax | Anthropic `https://api.minimaxi.com/anthropic/v1/messages`；Chat 备用 | thinking/tool use、主动或自动缓存、cache usage；稳定 tools/system/history | https://platform.minimaxi.com/docs/guides/text-generation ; https://platform.minimaxi.com/docs/api-reference/text-prompt-caching | 官网已确认 |
| 阶跃星辰 StepFun | Chat `https://api.stepfun.com/v1/chat/completions` | SSE、tool calls；缓存只映射官方公开字段 | https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create ; https://platform.stepfun.com/docs/zh/api-reference/tool-call ; https://platform.stepfun.com/docs/zh/guides/developer/stream | 官网已确认 |
| 科大讯飞星火 | Chat 兼容 `https://spark-api-open.xf-yun.com/x2/` | Bearer API password、SSE、tools、reasoning；路径随产品版本 | https://www.xfyun.cn/doc/spark/X1http.html | 官网已确认 |
| 华为云 MaaS | Chat `/v2/chat/completions`；地域域名由控制台给出 | Bearer、SSE、tools、reasoning、cache usage；必须允许手工地域 endpoint | https://support.huaweicloud.com/intl/en-us/model-call-maas/model-call-019.html ; https://support.huaweicloud.com/intl/en-us/model-call-maas/usermanual_maas_0008.html | 官网已确认 |
| 百川智能 | Chat `https://api.baichuan-ai.com/v1/chat/completions` | SSE/usage 已确认；tools/cache 若无当前明示则标为未确认 | https://platform.baichuan-ai.com/docs/api?activity=true | 部分能力官网已确认 |
| 零一万物 Yi | OpenAI 兼容 `https://api.lingyiwanwu.com/v1` | 允许手工模型；tools/cache 随最新文档和具体模型，未确认时关闭 | https://platform.lingyiwanwu.com/docs/api-reference | 部分能力官网已确认 |
| 商汤日日新 SenseNova | 自定义 `https://api.sensenova.cn/v1/llm/chat-completions` | 自定义响应包、SSE、usage；本阶段不宣称 tools/cache | https://platform.sensenova.cn/product/APIService/document | 文本调用已确认；tools/cache 未确认 |
| 小米 MiMo | Responses `https://api.xiaomimimo.com/v1/responses` | SSE、tools、reasoning、usage；续轮保留 reasoning item | https://mimo.mi.com/docs/en-US/api/chat/responses | 官网已确认 |
| 美团 LongCat | Anthropic `https://api.longcat.chat/anthropic/v1/messages`；Chat 备用 | 官方兼容两种协议、SSE、reasoning、usage；支持模型列表 | https://longcat.ai/platform/docs/zh/api-docs ; https://longcat.ai/platform/docs/zh/api/chat | 官网已确认 |
| 360 智脑 | Responses；同时公开 Chat 与 Messages | Bearer；stream/tools/cache 以具体接口与模型页为准 | https://ai.360.com/docs/quick-start | 官网已确认协议入口 |
| 蚂蚁百灵 | Anthropic `https://api.ant-ling.com/anthropic/v1/messages`；Chat 备用 | SSE、tools、thinking、usage；缓存只映射官方公开字段 | https://developer.ant-ling.com/zh-CN/docs/api-reference/ ; https://developer.ant-ling.com/zh-CN/docs/api-reference/anthropic/ | 官网已确认 |
| 中国电信 TeleChat / 星辰 MaaS | Chat `/aipaas/lm/v1/telechat/completions115` 加控制台服务地址 | `X-APP-ID`、`Order-Num`、Authorization 多字段鉴权；必须填写完整 URL | https://www.ctyun.cn/document/11092117/11094481 | 官网已确认；不是单 Key 接入 |
| 中国联通元景 MaaS | Chat `https://maas-api.ai-yuanjing.com/openapi/compatible-mode/v1/chat/completions` | Bearer、SSE；tools/reasoning/usage 取决于具体模型 | https://maas.ai-yuanjing.com/doc/pages/216543039/ ; https://maas.ai-yuanjing.com/doc/pages/216556869/ | 官网已确认 |
| 硅基流动 SiliconFlow | Chat `https://api.siliconflow.cn/v1/chat/completions` | Bearer、SSE、tools、reasoning；缓存只读官方 usage | https://docs.siliconflow.cn/en/api-reference/chat-completions/chat-completions | 官网已确认 |
| 魔搭 ModelScope API-Inference | OpenAI 兼容 `https://api-inference.modelscope.cn/v1` | 能力随模型变化；允许手工模型 ID，不宣称统一 tools/cache | https://www.modelscope.cn/docs/model-service/API-Inference/intro | 平台协议已确认，模型能力动态 |
| 京东云 JoyBuilder | Chat / Function Calling；完整服务地址由控制台或文档给出 | API Key、SSE、Function Calling；没有稳定统一 base URL 时要求手工填写 | https://docs.jdcloud.com/cn/jdaip/chat ; https://docs.jdcloud.com/cn/jdaip/FunctionCalling | 能力已确认；统一端点待配置 |

## 自定义入口

自定义 OpenAI-compatible 只允许用户明确填写 base URL、model、鉴权方式，并自行声明是否支持 stream/tools/reasoning/cache/usage。默认能力最小化，不能因为返回了文本就自动标成完整 Agent 兼容。

## 暂不列为官网已适配

本轮没有找到足够明确且当前的第一方公开通用文本 API 证据时，先由自定义端点覆盖，包括中国移动九天、昆仑万维天工、网易伏羲等。以后若官网资料明确，只需新增 profile 和合同测试。

## 实现与验收边界

1. 每个协议族必须有本地 fake，覆盖成功流、任意 SSE 分帧、工具调用/结果续轮、usage/cache、取消和代表性 HTTP 错误。
2. 每个 profile 必须有 serializer、endpoint、auth、capability 合同测试；元数据测试不能冒充真实 API 测试。
3. 没有 Secret 时 Provider 不可运行；renderer 只能看到 `configured`，不能读回秘密。
4. 云端 UI 分“国外模型 / 国内模型 / 国内平台 / 自定义”，另设低优先级“本地模型”入口；显示协议、能力、证据等级和手工配置要求，不展示价格。
5. Phase 6 仅按任务合同在所有离线门通过后执行有界 DeepSeek 真实产品链复验；不查询价格、金额或余额，不调用其他 Provider。真实 usage 冻结后不得因报告、截图或 harness 问题重复调用。
6. 模型目录必须用本地 fake 覆盖成功新增、成功移除、失败保留旧目录、活动 run 保持快照、旧会话变为 `model_unavailable` 和手工模型不被自动删除；fake 合同不能冒充真实模型列表通过。
7. 本地模型合同必须分别覆盖已有兼容端点和受管运行器，并验证内置/本地文件/自定义来源、来源与许可展示、显式下载、回环监听、更新只提醒、新旧版本并存、确认切换、取消和云端失败零静默回退。
8. profile、模型目录、路由和 usage UI 不得出现价格、金额、余额或费用字段；Token/缓存未提供时显示“未提供”，不填 0。
9. 本地工具能力必须分别覆盖原生工具调用、实验提示词模拟和无工具；格式失败不得执行，成功解析也必须经过普通权限与审计。硬件、真实生成和真实工具成功率必须另行真机验收。
10. 本地推理默认单路并发；fake 只能证明排队与共享名额合同，不能冒充真实内存/显存建议或多路生成稳定性。
