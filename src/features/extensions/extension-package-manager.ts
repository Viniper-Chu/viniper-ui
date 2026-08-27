import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { newId } from "../../core/ids";
import {
  ExtensionSourceKind,
  ManagedExtensionManifestV1,
  StagedExtensionPackage,
} from "../../core/extension-contracts";

export interface ExtensionStageInput {
  source: ExtensionSourceKind;
  location: string;
  versionOverride?: string;
}

export interface ExtensionPackageManagerOptions {
  dataRoot: string;
  loopbackResolver?: (url: string) => Promise<string>;
}

export interface MarketplaceManifestCheck {
  packagePath: string;
  manifest: ManagedExtensionManifestV1;
}

/**
 * CP5 package boundary. Inspecting a package only reads its manifest and
 * copies inert files into the managed staging directory; it never loads the
 * entry point.
 */
export class ExtensionPackageManager {
  private readonly stagingRoot: string;

  constructor(private readonly options: ExtensionPackageManagerOptions) {
    this.stagingRoot = join(options.dataRoot, "extensions", "staging");
  }

  async stage(input: ExtensionStageInput): Promise<StagedExtensionPackage> {
    const sourcePath = await this.resolveSource(input.location);
    const sourceManifest = await readManifest(sourcePath);
    if (!sourceManifest || typeof sourceManifest !== "object") throw new Error("EXTENSION_MANIFEST_INVALID");
    const manifest = validateManifest({
      ...(sourceManifest as Record<string, unknown>),
      source: input.source,
      ...(input.versionOverride ? { version: input.versionOverride } : {}),
    });
    const stagingId = newId("extension-stage");
    const target = join(this.stagingRoot, stagingId);
    await mkdir(dirname(target), { recursive: true });
    await cp(sourcePath, target, { recursive: true, errorOnExist: true });
    if (input.versionOverride) {
      await writeFile(join(target, "extension.json"), JSON.stringify(manifest, null, 2), "utf8");
    }
    if (manifest.entry) await assertSafeEntry(target, manifest.entry);
    return { stagingId, source: input.source, packagePath: target, manifest };
  }

  async inspectMarketplaceDirectory(input: {
    source: "marketplace-fixture" | "official" | "community" | "custom";
    directory: string;
  }): Promise<MarketplaceManifestCheck[]> {
    const root = resolve(input.directory);
    const entries = await readdir(root, { withFileTypes: true });
    const checks: MarketplaceManifestCheck[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (!entry.isDirectory()) continue;
      const packagePath = join(root, entry.name);
      const manifest = validateManifest({ ...(await readManifest(packagePath) as Record<string, unknown>), source: input.source });
      if (manifest.kind === "executable-plugin" && !manifest.entry) throw new Error("EXTENSION_ENTRY_REQUIRED");
      checks.push({ packagePath, manifest });
    }
    return checks;
  }

  async stageMarketplacePackage(input: {
    source: "marketplace-fixture" | "official" | "community" | "custom";
    directory: string;
    packageId: string;
  }): Promise<StagedExtensionPackage> {
    const checks = await this.inspectMarketplaceDirectory(input);
    const match = checks.find((item) => item.manifest.id === input.packageId);
    if (!match) throw new Error("EXTENSION_MARKETPLACE_PACKAGE_NOT_FOUND");
    return this.stage({ source: input.source, location: match.packagePath });
  }

  async removeStaged(packagePath: string): Promise<void> {
    const resolved = resolve(packagePath);
    const root = resolve(this.stagingRoot);
    if (relative(root, resolved).startsWith("..") || isAbsolute(relative(root, resolved))) {
      throw new Error("EXTENSION_STAGING_PATH_INVALID");
    }
    const { rm } = await import("node:fs/promises");
    await rm(resolved, { recursive: true, force: true });
  }

  private async resolveSource(location: string): Promise<string> {
    if (isHttpLocation(location)) {
      assertLoopbackOnly(location);
      if (!this.options.loopbackResolver) throw new Error("EXTENSION_LOOPBACK_SOURCE_UNAVAILABLE");
      return resolve(await this.options.loopbackResolver(location));
    }
    const sourcePath = resolve(location);
    return sourcePath;
  }
}

export function assertLoopbackOnly(location: string): void {
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    throw new Error("EXTENSION_SOURCE_URL_INVALID");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!(["localhost", "127.0.0.1", "::1"].includes(hostname))) {
    throw new Error("OUTBOUND_NETWORK_BLOCKED");
  }
}

async function readManifest(packagePath: string): Promise<unknown> {
  const file = join(packagePath, "extension.json");
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function validateManifest(value: unknown): ManagedExtensionManifestV1 {
  if (!value || typeof value !== "object") throw new Error("EXTENSION_MANIFEST_INVALID");
  const candidate = value as Record<string, unknown>;
  const stringFields = ["id", "name", "version", "kind", "source"];
  if (candidate.manifestVersion !== 1 || stringFields.some((field) => typeof candidate[field] !== "string")) {
    throw new Error("EXTENSION_MANIFEST_INVALID");
  }
  if (!["skill", "mcp", "executable-plugin"].includes(candidate.kind as string)) {
    throw new Error("EXTENSION_KIND_INVALID");
  }
  if (!["built-in", "official", "community", "custom", "local", "marketplace-fixture"].includes(candidate.source as string)) {
    throw new Error("EXTENSION_SOURCE_KIND_INVALID");
  }
  const capabilities = candidate.capabilities;
  if (!Array.isArray(capabilities) || capabilities.some((item) => typeof item !== "string")) {
    throw new Error("EXTENSION_CAPABILITIES_INVALID");
  }
  const tools = candidate.tools ?? [];
  if (!Array.isArray(tools) || tools.some((item) => typeof item !== "string")) {
    throw new Error("EXTENSION_TOOLS_INVALID");
  }
  const entry = candidate.entry;
  if (entry !== undefined && typeof entry !== "string") throw new Error("EXTENSION_ENTRY_INVALID");
  if (candidate.kind === "executable-plugin" && typeof entry !== "string") throw new Error("EXTENSION_ENTRY_REQUIRED");
  return {
    manifestVersion: 1,
    id: candidate.id as string,
    name: candidate.name as string,
    version: candidate.version as string,
    kind: candidate.kind as ManagedExtensionManifestV1["kind"],
    source: candidate.source as ManagedExtensionManifestV1["source"],
    capabilities: [...capabilities] as string[],
    tools: [...tools] as string[],
    ...(entry ? { entry } : {}),
    ...(typeof candidate.mcpEndpoint === "string" ? { mcpEndpoint: candidate.mcpEndpoint } : {}),
  };
}

async function assertSafeEntry(packagePath: string, entry: string): Promise<void> {
  if (isAbsolute(entry) || entry.includes("..")) throw new Error("EXTENSION_ENTRY_PATH_INVALID");
  const path = resolve(packagePath, entry);
  const root = resolve(packagePath);
  const relativePath = relative(root, path);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("EXTENSION_ENTRY_PATH_INVALID");
  }
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error("EXTENSION_ENTRY_MISSING");
}

function isHttpLocation(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}
