import { SecretVault } from "../../core/ports";

/** Viniper workstation CLI Preview can inspect configuration state but never stores or reveals secrets. */
export class UnavailableSecretVault implements SecretVault {
  isEncryptionAvailable(): boolean { return false; }
  async setSecret(): Promise<void> { throw new Error("Viniper workstation CLI Preview 不保存 Provider 密钥；请在桌面设置中配置。 "); }
  async readSecret(): Promise<null> { return null; }
  async deleteSecret(): Promise<void> { throw new Error("Viniper workstation CLI Preview 不管理 Provider 密钥；请在桌面设置中操作。 "); }
  async isConfigured(): Promise<boolean> { return false; }
}
