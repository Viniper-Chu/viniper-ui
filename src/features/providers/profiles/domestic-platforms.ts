import { ProviderProfile } from "../../../core/provider-contracts";
import { bearerAuth, capabilities, fixedProfile, manualProfile } from "./profile-helpers";

const official = "officially-documented" as const;
const dependent = "profile-dependent" as const;
const unconfirmed = "manual-unconfirmed" as const;

export const DOMESTIC_PLATFORM_PROFILES: ProviderProfile[] = [
  manualProfile({
    id: "alibaba-bailian", label: "阿里云百炼 / Qwen", category: "domestic-platform", vendor: "阿里云", protocol: "openai-responses",
    placeholder: "请选择账号地域并填写 Responses 完整地址", regional: true, auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Responses、tools 与上下文缓存由官网确认；端点取决于地域", documentation: ["https://help.aliyun.com/en/model-studio/qwen-api-via-openai-responses", "https://help.aliyun.com/en/model-studio/context-cache"],
    cachePolicyId: "provider-reported", continuationMode: "server-optional",
  }),
  fixedProfile({
    id: "volcengine-ark", label: "火山引擎方舟 / 豆包", category: "domestic-platform", vendor: "火山引擎", protocol: "openai-responses",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/responses", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Responses、工具续轮与上下文缓存由官网确认", documentation: ["https://www.volcengine.com/docs/82379/1795150", "https://www.volcengine.com/docs/82379/1958524"],
    cachePolicyId: "provider-reported", continuationMode: "server-optional",
  }),
  manualProfile({
    id: "tencent-tokenhub", label: "腾讯云 TokenHub / 混元", category: "domestic-platform", vendor: "腾讯云", protocol: "openai-responses",
    placeholder: "请填写 TokenHub 控制台提供的 Responses 完整地址", regional: true, auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "TokenHub Responses/Anthropic、tools 与 cache usage 已确认", documentation: ["https://cloud.tencent.com/document/product/1823/132252", "https://cloud.tencent.com/document/product/1823/130079"],
    cachePolicyId: "provider-reported", continuationMode: "server-optional",
  }),
  fixedProfile({
    id: "baidu-qianfan", label: "百度千帆 / 文心", category: "domestic-platform", vendor: "百度智能云", protocol: "openai-responses",
    endpoint: "https://qianfan.baidubce.com/v2/responses", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, dependent, official), evidenceLevel: official,
    evidenceLabel: "Responses、tools、reasoning 与 usage 已确认", documentation: ["https://cloud.baidu.com/doc/qianfan-docs/s/4mi400l1m"],
    cachePolicyId: "provider-reported", continuationMode: "server-optional",
  }),
  manualProfile({
    id: "huawei-maas", label: "华为云 MaaS", category: "domestic-platform", vendor: "华为云", protocol: "openai-chat",
    placeholder: "请填写控制台地域域名下的 /v2/chat/completions 完整地址", regional: true, auth: bearerAuth(),
    capabilities: capabilities(official, official, official, official, official), evidenceLevel: official,
    evidenceLabel: "Chat、SSE、tools 与 cache usage 已确认；必须配置地域地址", documentation: ["https://support.huaweicloud.com/intl/en-us/model-call-maas/model-call-019.html"],
    cachePolicyId: "provider-reported", continuationMode: "local-history",
  }),
  manualProfile({
    id: "ctyun-telechat", label: "中国电信 TeleChat / 星辰 MaaS", category: "domestic-platform", vendor: "中国电信", protocol: "openai-chat",
    placeholder: "请填写控制台服务地址（含 /aipaas/lm/v1/telechat/completions115）", auth: [
      { id: "app-id", label: "X-APP-ID", placement: "header", name: "X-APP-ID", required: true },
      { id: "order-num", label: "Order-Num", placement: "header", name: "Order-Num", required: true },
      { id: "api-key", label: "Authorization", placement: "header", name: "Authorization", prefix: "Bearer ", required: true },
    ],
    capabilities: capabilities(official, official, dependent, unconfirmed, official), evidenceLevel: official,
    evidenceLabel: "多字段鉴权与 Function Calling 已确认；完整服务地址必须手工填写", documentation: ["https://www.ctyun.cn/document/11092117/11094481"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "unicom-yuanjing", label: "中国联通元景 MaaS", category: "domestic-platform", vendor: "中国联通", protocol: "openai-chat",
    endpoint: "https://maas-api.ai-yuanjing.com/openapi/compatible-mode/v1/chat/completions", auth: bearerAuth(),
    capabilities: capabilities(official, dependent, dependent, unconfirmed, dependent), evidenceLevel: dependent,
    evidenceLabel: "兼容 Chat 与 SSE 已确认；其余能力依具体模型", documentation: ["https://maas.ai-yuanjing.com/doc/pages/216543039/", "https://maas.ai-yuanjing.com/doc/pages/216556869/"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "siliconflow", label: "硅基流动 SiliconFlow", category: "domestic-platform", vendor: "SiliconFlow", protocol: "openai-chat",
    endpoint: "https://api.siliconflow.cn/v1/chat/completions", modelsEndpoint: "https://api.siliconflow.cn/v1/models", auth: bearerAuth(),
    capabilities: capabilities(official, official, official, dependent, official), evidenceLevel: official,
    evidenceLabel: "Chat、SSE、tools 与 reasoning 已确认；缓存只读官方 usage", documentation: ["https://docs.siliconflow.cn/en/api-reference/chat-completions/chat-completions"],
    cachePolicyId: "provider-reported", continuationMode: "local-history",
  }),
  fixedProfile({
    id: "modelscope", label: "魔搭 ModelScope API-Inference", category: "domestic-platform", vendor: "ModelScope", protocol: "openai-chat",
    endpoint: "https://api-inference.modelscope.cn/v1/chat/completions", modelsEndpoint: "https://api-inference.modelscope.cn/v1/models", auth: bearerAuth(),
    capabilities: capabilities(official, dependent, dependent, unconfirmed, dependent), evidenceLevel: dependent,
    evidenceLabel: "平台兼容协议已确认；模型能力动态，不默认宣称 tools/cache", documentation: ["https://www.modelscope.cn/docs/model-service/API-Inference/intro"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
  manualProfile({
    id: "jdcloud-joybuilder", label: "京东云 JoyBuilder", category: "domestic-platform", vendor: "京东云", protocol: "openai-chat",
    placeholder: "请填写控制台给出的 Chat 完整服务地址", auth: bearerAuth(),
    capabilities: capabilities(official, official, dependent, unconfirmed, official), evidenceLevel: dependent,
    evidenceLabel: "Chat 与 Function Calling 已确认；统一端点需手工配置", documentation: ["https://docs.jdcloud.com/cn/jdaip/chat", "https://docs.jdcloud.com/cn/jdaip/FunctionCalling"],
    cachePolicyId: "unconfirmed", continuationMode: "local-history",
  }),
];
