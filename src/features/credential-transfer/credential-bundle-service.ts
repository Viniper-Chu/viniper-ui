import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface PortableCredentialEntry { id: string; label: string; configured: boolean }

export interface PortableCredentialVault {
  listPortable(): Promise<PortableCredentialEntry[]>;
  read(id: string): Promise<string | undefined>;
  write(id: string, value: string): Promise<void>;
}

export interface CredentialBundleServiceOptions { vault: PortableCredentialVault }

interface SecretBundle {
  format: "viniper-harness-secret-bundle";
  schemaVersion: 1;
  kdf: { name: "scrypt"; salt: string; cost: number; blockSize: number; parallelization: number };
  cipher: { name: "aes-256-gcm"; iv: string; tag: string };
  ciphertext: string;
  entryIds: string[];
}

export class CredentialBundleService {
  constructor(private readonly options: CredentialBundleServiceOptions) {}

  async exportBundle(input: { targetPath: string; entryIds: string[]; password: string }): Promise<void> {
    if (!input.password) throw new Error("SECRET_BUNDLE_PASSWORD_REQUIRED");
    const available = new Map((await this.options.vault.listPortable()).map((entry) => [entry.id, entry]));
    const entries: Array<{ id: string; value: string }> = [];
    for (const id of [...new Set(input.entryIds)]) {
      const metadata = available.get(id);
      if (!metadata) throw new Error(`SECRET_ENTRY_NOT_FOUND:${id}`);
      const value = await this.options.vault.read(id);
      if (value === undefined) throw new Error(`SECRET_ENTRY_UNCONFIGURED:${id}`);
      entries.push({ id, value });
    }
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(input.password, salt, 32, { N: 16_384, r: 8, p: 1 });
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ entries }), "utf8"), cipher.final()]);
    const bundle: SecretBundle = {
      format: "viniper-harness-secret-bundle",
      schemaVersion: 1,
      kdf: { name: "scrypt", salt: salt.toString("base64"), cost: 16_384, blockSize: 8, parallelization: 1 },
      cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
      ciphertext: ciphertext.toString("base64"),
      entryIds: entries.map((entry) => entry.id),
    };
    await atomicWrite(input.targetPath, JSON.stringify(bundle, null, 2));
  }

  async importBundle(input: { sourcePath: string; password: string; confirm: boolean; overwrite?: boolean }): Promise<{ status: "preview" | "imported"; imported: string[]; conflicts: string[] }> {
    const bundle = JSON.parse(await readFile(input.sourcePath, "utf8")) as SecretBundle;
    const entries = decryptBundle(bundle, input.password);
    const conflicts: string[] = [];
    const imported: string[] = [];
    for (const entry of entries) {
      const local = await this.options.vault.read(entry.id);
      if (local !== undefined && !input.overwrite) conflicts.push(entry.id);
      else imported.push(entry.id);
    }
    if (!input.confirm) return { status: "preview", imported, conflicts };
    for (const entry of entries) {
      const local = await this.options.vault.read(entry.id);
      if (local !== undefined && !input.overwrite) continue;
      await this.options.vault.write(entry.id, entry.value);
    }
    return { status: "imported", imported, conflicts };
  }
}

function decryptBundle(bundle: SecretBundle, password: string): Array<{ id: string; value: string }> {
  if (bundle.format !== "viniper-harness-secret-bundle" || bundle.schemaVersion !== 1) throw new Error("SECRET_BUNDLE_INVALID");
  const salt = Buffer.from(bundle.kdf.salt, "base64");
  const iv = Buffer.from(bundle.cipher.iv, "base64");
  const tag = Buffer.from(bundle.cipher.tag, "base64");
  const key = scryptSync(password, salt, 32, { N: bundle.kdf.cost, r: bundle.kdf.blockSize, p: bundle.kdf.parallelization });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const raw = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()]).toString("utf8");
  const value = JSON.parse(raw) as { entries?: Array<{ id: string; value: string }> };
  if (!Array.isArray(value.entries) || value.entries.some((entry) => typeof entry.id !== "string" || typeof entry.value !== "string")) throw new Error("SECRET_BUNDLE_PAYLOAD_INVALID");
  return value.entries;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  await rename(temp, path).catch(async (error) => { await rm(temp, { force: true }); throw error; });
}
