import { safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SecretVault } from "../../core/ports";

export class SafeStorageSecretVault implements SecretVault {
  constructor(private readonly encryptedPath: string) {}

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  async setSecret(id: string, value: string): Promise<void> {
    if (!this.isEncryptionAvailable()) throw new Error("系统安全存储不可用，密钥未保存。 ");
    const records = await this.loadEncrypted();
    records[id] = (await safeStorage.encryptStringAsync(value)).toString("base64");
    await this.saveEncrypted(records);
  }

  async readSecret(id: string): Promise<string | null> {
    if (!this.isEncryptionAvailable()) return null;
    const records = await this.loadEncrypted();
    const encoded = records[id];
    if (!encoded) return null;
    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(encoded, "base64"));
      if (decrypted.shouldReEncrypt) {
        records[id] = (await safeStorage.encryptStringAsync(decrypted.result)).toString("base64");
        await this.saveEncrypted(records);
      }
      return decrypted.result;
    } catch {
      throw new Error("已保存密钥无法由当前系统账户解密。 ");
    }
  }

  async deleteSecret(id: string): Promise<void> {
    const records = await this.loadEncrypted();
    delete records[id];
    await this.saveEncrypted(records);
  }

  async isConfigured(id: string): Promise<boolean> {
    return Boolean((await this.loadEncrypted())[id]);
  }

  private async loadEncrypted(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.encryptedPath, "utf8")) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("安全存储文件无法读取。 ");
    }
  }

  private async saveEncrypted(records: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.encryptedPath), { recursive: true });
    await writeFile(this.encryptedPath, JSON.stringify(records, null, 2), "utf8");
  }
}
