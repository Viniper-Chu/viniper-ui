import { ProductSettingsSnapshot } from "../../core/cp7-contracts";

export interface ProductSettingsPersistence {
  load(key: string): Promise<unknown>;
  save(key: string, value: unknown): Promise<void>;
}

const DEFAULT_SETTINGS: ProductSettingsSnapshot = {
  closeBehavior: "ask",
  maxConcurrentRuns: 3,
  notificationsEnabled: true,
  soundEnabled: false,
  retentionDays: "never",
  memoryWarningRatio: 0.8,
  memoryStaleDays: 90,
  diagnosticsConsent: false,
  providerNetworkMode: "system",
  providerStatusVisible: true,
  localModelsEnabled: true,
  localModelConcurrency: 1,
  updateChannel: "preview",
  geminiServerStateEnabled: false,
};

export class ProductSettingsService {
  private value: ProductSettingsSnapshot;
  private initialized = false;

  constructor(
    private readonly persistence: ProductSettingsPersistence,
    defaults: Partial<ProductSettingsSnapshot> = {},
  ) {
    this.value = normalize({ ...DEFAULT_SETTINGS, ...defaults });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const stored = await this.persistence.load("cp7.product-settings");
    if (stored && typeof stored === "object") this.value = normalize({ ...this.value, ...(stored as Partial<ProductSettingsSnapshot>) });
    this.initialized = true;
  }

  snapshot(): ProductSettingsSnapshot { return { ...this.value }; }

  async update(input: Partial<ProductSettingsSnapshot>): Promise<ProductSettingsSnapshot> {
    this.value = normalize({ ...this.value, ...input });
    await this.persistence.save("cp7.product-settings", this.value);
    return this.snapshot();
  }
}

function normalize(value: ProductSettingsSnapshot): ProductSettingsSnapshot {
  if (value.maxConcurrentRuns < 1 || value.maxConcurrentRuns > 8) throw new Error("全局并发必须在 1 到 8 之间。");
  if (value.localModelConcurrency < 1 || value.localModelConcurrency > 8) throw new Error("本地模型并发必须在 1 到 8 之间。");
  if (value.memoryWarningRatio <= 0 || value.memoryWarningRatio >= 1) throw new Error("记忆容量提醒比例无效。");
  return value;
}
