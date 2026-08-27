import { ProviderProfile } from "../../../core/provider-contracts";
import { anthropicAuth, bearerAuth, capabilities, fixedProfile, manualProfile } from "./profile-helpers";

const official = "officially-documented" as const;
const dependent = "profile-dependent" as const;
const unconfirmed = "manual-unconfirmed" as const;
const unsupported = "unsupported" as const;

export const DOMESTIC_MODEL_PROFILES: ProviderProfile[] = [
  fixedProfile({
    id: "deepseek", label: "DeepSeek", category: "domestic-model", vendor: "DeepSeek", protocol: "openai-chat",
    endpoint: "https://api.deepseek.com/chat/completions", modelsEndpoint: "https://api.deepseek.com/models", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Chat、tools、reasoning 与 cache usage 由官网确认", documentation: ["https://api-docs.deepseek.com/api/create-chat-completion"],
    cachePolicyId: "provider-reported", continuationMode: "local-history",
    currentModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
  }),
  fixedProfile({
    id: "zhipu-glm", label: "智谱 GLM", category: "domestic-model", vendor: "智谱 AI", protocol: "openai-chat",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Chat、tools、reasoning 与 cached usage 由官网确认", documentation: ["https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8"],
    cachePolicyId: "provider-reported", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "moonshot-kimi", label: "月之暗面 Kimi", category: "domestic-model", vendor: "Moonshot AI", protocol: "openai-chat",
    endpoint: "https://api.moonshot.cn/v1/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Chat、tools、reasoning 与缓存字段由官网确认", documentation: ["https://platform.kimi.com/docs/api/chat"],
    cachePolicyId: "provider-reported", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "minimax", label: "MiniMax", category: "domestic-model", vendor: "MiniMax", protocol: "anthropic-messages",
    endpoint: "https://api.minimaxi.com/anthropic/v1/messages", auth: anthropicAuth(), staticHeaders: { "anthropic-version": "2023-06-01" },
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Anthropic 兼容、thinking、tools 与缓存由官网确认", documentation: ["https://platform.minimaxi.com/docs/guides/text-generation", "https://platform.minimaxi.com/docs/api-reference/text-prompt-caching"],
    cachePolicyId: "minimax-auto", continuationMode: "stateless",
  }),
  fixedProfile({
    id: "stepfun", label: "阶跃星辰 StepFun", category: "domestic-model", vendor: "StepFun", protocol: "openai-chat",
    endpoint: "https://api.stepfun.com/v1/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, official, dependent, unconfirmed, official), evidenceLevel: official,
    evidenceLabel: "Chat、SSE 与 tools 由官网确认；缓存未统一确认", documentation: ["https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create", "https://platform.stepfun.com/docs/zh/api-reference/tool-call"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "iflytek-spark", label: "科大讯飞星火", category: "domestic-model", vendor: "科大讯飞", protocol: "openai-chat",
    endpoint: "https://spark-api-open.xf-yun.com/x2/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, unconfirmed, official), evidenceLevel: official,
    evidenceLabel: "当前产品路径、tools 与 reasoning 由官网确认；缓存未确认", documentation: ["https://www.xfyun.cn/doc/spark/X1http.html"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "baichuan", label: "百川智能", category: "domestic-model", vendor: "百川智能", protocol: "openai-chat",
    endpoint: "https://api.baichuan-ai.com/v1/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, unconfirmed, dependent, unconfirmed, official), evidenceLevel: dependent,
    evidenceLabel: "SSE/usage 已确认；tools/cache 随模型且本阶段不默认开启", documentation: ["https://platform.baichuan-ai.com/docs/api?activity=true"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "yi", label: "零一万物 Yi", category: "domestic-model", vendor: "零一万物", protocol: "openai-chat",
    endpoint: "https://api.lingyiwanwu.com/v1/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, unconfirmed, dependent, unconfirmed, dependent), evidenceLevel: dependent,
    evidenceLabel: "兼容协议已确认；tools/cache 依模型且默认关闭", documentation: ["https://platform.lingyiwanwu.com/docs/api-reference"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "sensenova", label: "商汤日日新 SenseNova", category: "domestic-model", vendor: "商汤科技", protocol: "sensenova",
    endpoint: "https://api.sensenova.cn/v1/llm/chat-completions", auth: bearerAuth(),
    capabilities: capabilities(official, unsupported, unsupported, unsupported, official), evidenceLevel: official,
    evidenceLabel: "文本流与 usage 已确认；tools/cache 未确认并保持关闭", documentation: ["https://platform.sensenova.cn/product/APIService/document"],
    cachePolicyId: "unsupported", continuationMode: "stateless",
  }),
  fixedProfile({
    id: "xiaomi-mimo", label: "小米 MiMo", category: "domestic-model", vendor: "小米", protocol: "openai-responses",
    endpoint: "https://api.xiaomimimo.com/v1/responses", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Responses、tools、reasoning 与 usage 已确认；续轮必须本地重发历史", documentation: ["https://mimo.mi.com/docs/en-US/api/chat/responses"],
    cachePolicyId: "mimo-local-history", continuationMode: "local-history", preserveReasoningItems: true,
  }),
  fixedProfile({
    id: "longcat", label: "美团 LongCat", category: "domestic-model", vendor: "美团", protocol: "anthropic-messages",
    endpoint: "https://api.longcat.chat/anthropic/v1/messages", modelsEndpoint: "https://api.longcat.chat/v1/models", auth: bearerAuth(), staticHeaders: { "anthropic-version": "2023-06-01" },
    capabilities: capabilities(official, official, official, dependent, official), evidenceLevel: official,
    evidenceLabel: "Anthropic/Chat 兼容、SSE 与 reasoning 已确认", documentation: ["https://longcat.ai/platform/docs/zh/api-docs", "https://longcat.ai/platform/docs/zh/api/chat"],
    cachePolicyId: "provider-reported", continuationMode: "stateless",
  }),
  manualProfile({
    id: "360-zhinao", label: "360 智脑", category: "domestic-model", vendor: "360 智脑", protocol: "openai-responses",
    placeholder: "请填写控制台给出的 Responses 完整地址", auth: bearerAuth(),
    capabilities: capabilities(official, dependent, dependent, dependent, dependent), evidenceLevel: dependent,
    evidenceLabel: "协议入口已确认；具体能力随接口与模型", documentation: ["https://ai.360.com/docs/quick-start"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "ant-ling", label: "蚂蚁百灵", category: "domestic-model", vendor: "蚂蚁集团", protocol: "anthropic-messages",
    endpoint: "https://api.ant-ling.com/anthropic/v1/messages", auth: anthropicAuth(), staticHeaders: { "anthropic-version": "2023-06-01" },
    capabilities: capabilities(official, official, official, unconfirmed, official), evidenceLevel: official,
    evidenceLabel: "Anthropic、SSE、tools 与 thinking 已确认；缓存字段未统一确认", documentation: ["https://developer.ant-ling.com/zh-CN/docs/api-reference/", "https://developer.ant-ling.com/zh-CN/docs/api-reference/anthropic/"],
    cachePolicyId: "unconfirmed", continuationMode: "stateless",
  }),
];
