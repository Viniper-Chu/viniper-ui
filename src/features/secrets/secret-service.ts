import { SecretReferencePersistence, SecretVault } from "../../core/ports";
import { SecretReference, SecretSnapshot } from "../../core/security-contracts";

export type SecretListener = (snapshot: SecretSnapshot) => void;

export class SecretService {
  private readonly references = new Map<string, SecretReference>();
  private readonly listeners = new Set<SecretListener>();

  constructor(
    private readonly vault: SecretVault,
    private readonly persistence: SecretReferencePersistence,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    for (const reference of await this.persistence.loadSecretReferences()) this.references.set(reference.id, reference);
    if (this.vault.isEncryptionAvailable()) {
      for (const reference of this.references.values()) {
        reference.configured = await this.vault.isConfigured(reference.id);
      }
      await this.persist();
    }
    this.publish();
  }

  subscribe(listener: SecretListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async setSecret(id: string, value: string): Promise<{ configured: boolean; message: string }> {
    if (!this.vault.isEncryptionAvailable()) {
      return { configured: false, message: "系统安全存储当前不可用，未保存密钥。" };
    }
    if (!value.trim()) return { configured: false, message: "请输入新的密钥。" };
    await this.vault.setSecret(id, value);
    this.references.set(id, { id, configured: true, updatedAt: this.now() });
    await this.persist();
    this.publish();
    return { configured: true, message: "密钥已由系统安全存储加密保存；不会回显。" };
  }

  async deleteSecret(id: string): Promise<{ configured: false; message: string }> {
    await this.vault.deleteSecret(id);
    this.references.set(id, { id, configured: false, updatedAt: this.now() });
    await this.persist();
    this.publish();
    return { configured: false, message: "密钥已删除。" };
  }

  async readForProvider(id: string): Promise<string | null> {
    if (!this.vault.isEncryptionAvailable()) return null;
    return this.vault.readSecret(id);
  }

  isConfigured(id: string): boolean {
    return this.vault.isEncryptionAvailable() && (this.references.get(id)?.configured ?? false);
  }

  snapshot(): SecretSnapshot {
    const encryptionAvailable = this.vault.isEncryptionAvailable();
    return {
      encryptionAvailable,
      references: [...this.references.values()].map((reference) => ({
        ...reference,
        configured: encryptionAvailable && reference.configured,
      })),
      message: encryptionAvailable
        ? "密钥只由主进程安全存储持有，界面不会读取明文。"
        : "系统安全存储不可用；密钥功能已安全关闭。",
    };
  }

  private persist(): Promise<void> {
    return this.persistence.saveSecretReferences([...this.references.values()].map((reference) => ({ ...reference })));
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
