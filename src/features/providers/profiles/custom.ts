import { ProviderProfile } from "../../../core/provider-contracts";
import { bearerAuth, capabilities, manualProfile } from "./profile-helpers";

export const CUSTOM_PROFILES: ProviderProfile[] = [
  manualProfile({
    id: "openai-compatible",
    label: "自定义 OpenAI-compatible",
    category: "custom",
    vendor: "自定义端点",
    protocol: "openai-chat",
    placeholder: "请输入完整 Chat Completions URL",
    auth: bearerAuth(),
    capabilities: capabilities("manual-unconfirmed", "manual-unconfirmed", "manual-unconfirmed", "manual-unconfirmed", "manual-unconfirmed"),
    evidenceLevel: "manual-unconfirmed",
    evidenceLabel: "仅提供最小兼容入口；能力必须由用户显式声明且真实状态未验证",
    documentation: [],
    cachePolicyId: "unsupported",
    continuationMode: "local-history",
  }),
];
