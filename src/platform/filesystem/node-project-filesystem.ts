import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ProjectChangeResult,
  ProjectDeleteInput,
  ProjectDiagnostic,
  ProjectDiagnosticCode,
  ProjectDiffArtifactSummary,
  ProjectDiffInput,
  ProjectDiffResult,
  ProjectDiffSlice,
  ProjectEditInput,
  ProjectFilesystem,
  ProjectFilesystemError,
  ProjectListInput,
  ProjectListResult,
  ProjectMoveInput,
  ProjectMutationAction,
  ProjectMutationContext,
  ProjectReadInput,
  ProjectReadResult,
  ProjectRestoreInput,
  ProjectSearchInput,
  ProjectSearchMatch,
  ProjectSearchResult,
  ProjectWriteInput,
} from "../../features/programming/contracts";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_SEARCH_RESULTS = 50;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const MAX_SEARCH_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_READ_SOURCE_BYTES = 512 * 1024;
const MAX_READ_OUTPUT_BYTES = 128 * 1024;
const MAX_READ_LINES = 400;
const MAX_SNIPPET_CHARS = 240;
const MAX_MUTATION_TEXT_BYTES = 512 * 1024;
const MAX_MUTATION_TREE_ENTRIES = 2_000;
const MAX_MUTATION_TREE_BYTES = 64 * 1024 * 1024;
const DEFAULT_DIFF_CHARS = 2_000;
const MAX_DIFF_CHARS = 12_000;

const NOISE_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
]);

const PRIVATE_BASENAMES = new Set([
  ".env",
  ".env.development",
  ".env.development.local",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.staging",
  ".env.test",
  ".env.test.local",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "provider-settings.json",
  "secrets.enc.json",
  "secrets.json",
]);

const PRIVATE_SUFFIXES = [".key", ".p12", ".pem", ".pfx", ".ppk"];
const PUBLIC_ENV_TEMPLATE_BASENAMES = new Set([".env.example", ".env.sample", ".env.template"]);

export interface NodeProjectFilesystemOptions {
  protectedRoots?: string[];
  managedRoot?: string;
  beforeAtomicCommit?: (operation: ProjectMutationAction, targetPath: string) => void | Promise<void>;
}

interface ResolvedTarget {
  root: string;
  absolute: string;
  canonical: string;
  relativePath: string;
}

interface MutableTarget {
  root: string;
  absolute: string;
  relativePath: string;
  exists: boolean;
  isDirectory: boolean;
}

interface ChangeArtifactRecord extends ProjectDiffArtifactSummary {
  runId: string;
  sessionId: string;
  projectRoot: string;
  createdAt: number;
  linesAdded: number;
  linesRemoved: number;
}

interface PreparedArtifact {
  record: ChangeArtifactRecord;
  pendingDirectory: string;
  finalDirectory: string;
  slice: ProjectDiffSlice;
}

interface RecoveryManifest {
  receiptId: string;
  runId: string;
  sessionId: string;
  projectRoot: string;
  originalPath: string;
  kind: "file" | "directory";
  beforeBytes: number;
  status: "available" | "restored";
  createdAt: number;
  restoredAt?: number;
}

export class NodeProjectFilesystem implements ProjectFilesystem {
  private protectedRootsPromise?: Promise<string[]>;
  private readonly workspaceRoots: string[] = [];

  constructor(private readonly options: NodeProjectFilesystemOptions = {}) {}

  /** Host-owned isolated worktrees are inside the Preview data root but are still explicit user project roots. */
  allowWorkspaceRoot(path: string): void {
    const root = resolve(path).replace(/[\\/]+$/u, "");
    if (!this.workspaceRoots.some((item) => sameCanonicalPath(item, root))) this.workspaceRoots.push(root);
  }

  async canonicalizeProjectRoot(path: string): Promise<string> {
    const candidate = resolve(path.trim());
    let metadata;
    try {
      metadata = await stat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProjectFilesystemError("PROJECT_NOT_FOUND", "项目目录不存在；当前会话未改变。");
      }
      throw new ProjectFilesystemError("PROJECT_NOT_READABLE", "项目目录不可读取；当前会话未改变。");
    }
    if (!metadata.isDirectory()) {
      throw new ProjectFilesystemError("PROJECT_NOT_DIRECTORY", "所选路径不是目录；当前会话未改变。");
    }
    try {
      await access(candidate, constants.R_OK);
    } catch {
      throw new ProjectFilesystemError("PROJECT_NOT_READABLE", "项目目录不可读取；当前会话未改变。");
    }
    const canonical = await realpath(candidate);
    if (await this.isProtectedPath(canonical)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "该目录属于 Viniper workstation Preview 受管数据，不能作为项目打开。");
    }
    return canonical;
  }

  async list(projectRoot: string, input: ProjectListInput, signal?: AbortSignal): Promise<ProjectListResult> {
    const root = await this.canonicalRoot(projectRoot);
    const path = normalizeRelativeDisplay(input.path);
    const limit = boundedInteger(input.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    try {
      throwIfAborted(signal);
      const target = await this.resolveTarget(root, path, "directory");
      const children = await readdir(target.canonical, { withFileTypes: true });
      const entries = [];
      let blockedCount = 0;
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
        const childRelative = joinRelative(target.relativePath, child.name);
        const childAbsolute = resolve(target.absolute, child.name);
        if (isNoiseRelative(childRelative)
          || isPrivateRelative(childRelative)
          || await this.isProtectedPath(childAbsolute)) {
          blockedCount += 1;
          continue;
        }
        entries.push({
          name: child.name,
          type: child.isFile() ? "file" as const
            : child.isDirectory() ? "directory" as const
              : child.isSymbolicLink() ? "symlink" as const : "other" as const,
          path: childRelative,
        });
      }
      return {
        ok: true,
        projectRoot: root,
        path: target.relativePath,
        entries: entries.slice(0, limit),
        limit,
        truncated: entries.length > limit,
        blockedCount,
      };
    } catch (error) {
      return listFailure(root, path, limit, diagnostic(error));
    }
  }

  async search(projectRoot: string, input: ProjectSearchInput, signal?: AbortSignal): Promise<ProjectSearchResult> {
    const root = await this.canonicalRoot(projectRoot);
    const query = input.query?.trim() ?? "";
    const path = normalizeRelativeDisplay(input.path);
    const maxResults = boundedInteger(input.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
    if (!query) {
      return searchFailure(root, query, path, maxResults, projectDiagnostic(
        "QUERY_REQUIRED",
        "搜索词不能为空；没有项目内容发送给模型。",
      ));
    }
    try {
      throwIfAborted(signal);
      const target = await this.resolveTarget(root, path, "any");
      const results: ProjectSearchMatch[] = [];
      const queryLower = query.toLocaleLowerCase("zh-CN");
      let scannedFiles = 0;
      let scannedBytes = 0;
      let truncated = false;
      const pending = [target];

      while (pending.length > 0 && results.length < maxResults) {
        throwIfAborted(signal);
        const current = pending.shift()!;
        const metadata = await stat(current.canonical);
        if (metadata.isFile()) {
          if (scannedFiles >= MAX_SEARCH_FILES || scannedBytes + metadata.size > MAX_SEARCH_TOTAL_BYTES) {
            truncated = true;
            break;
          }
          scannedFiles += 1;
          if (metadata.size > MAX_SEARCH_FILE_BYTES) continue;
          scannedBytes += metadata.size;
          const bytes = await readFile(current.canonical);
          const text = decodeUtf8(bytes);
          if (text === null) continue;
          const lines = splitTextLines(text);
          for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index].toLocaleLowerCase("zh-CN").includes(queryLower)) continue;
            results.push({
              path: current.relativePath,
              line: index + 1,
              snippet: snippet(lines[index]),
              match: "text",
              source: "live",
            });
            if (results.length >= maxResults) {
              truncated = true;
              break;
            }
          }
          continue;
        }

        let children;
        try {
          children = await readdir(current.canonical, { withFileTypes: true });
        } catch {
          truncated = true;
          continue;
        }
        const nextFiles: ResolvedTarget[] = [];
        const nextDirectories: ResolvedTarget[] = [];
        for (const child of children.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
          const childRelative = joinRelative(current.relativePath, child.name);
          const childAbsolute = resolve(current.absolute, child.name);
          if (isNoiseRelative(childRelative)
            || isPrivateRelative(childRelative)
            || await this.isProtectedPath(childAbsolute)
            || child.isSymbolicLink()) continue;
          if (childRelative.toLocaleLowerCase("zh-CN").includes(queryLower)) {
            results.push({
              path: childRelative,
              line: null,
              snippet: childRelative,
              match: "path",
              source: "live",
            });
            if (results.length >= maxResults) {
              truncated = true;
              break;
            }
          }
          const childCanonical = await realpath(childAbsolute);
          const childTarget = { root, absolute: childAbsolute, canonical: childCanonical, relativePath: childRelative };
          if (child.isDirectory()) nextDirectories.push(childTarget);
          else if (child.isFile()) nextFiles.push(childTarget);
        }
        pending.unshift(...nextFiles);
        pending.push(...nextDirectories);
      }

      results.sort((left, right) => left.path.localeCompare(right.path, "en")
        || (left.line ?? 0) - (right.line ?? 0)
        || left.match.localeCompare(right.match, "en"));
      return {
        ok: true,
        projectRoot: root,
        query,
        path: target.relativePath,
        results: results.slice(0, maxResults),
        maxResults,
        scannedFiles,
        truncated,
        source: "live",
      };
    } catch (error) {
      return searchFailure(root, query, path, maxResults, diagnostic(error));
    }
  }

  async read(projectRoot: string, input: ProjectReadInput, signal?: AbortSignal): Promise<ProjectReadResult> {
    const root = await this.canonicalRoot(projectRoot);
    const path = normalizeRelativeDisplay(input.path, false);
    try {
      throwIfAborted(signal);
      const target = await this.resolveTarget(root, path, "file");
      const metadata = await stat(target.canonical);
      if (metadata.size > MAX_READ_SOURCE_BYTES) {
        return readFailure(root, target.relativePath, metadata.size, "too-large", projectDiagnostic(
          "FILE_TOO_LARGE",
          `文件大小为 ${metadata.size} 字节，超过 P1 单次读取上限；文件正文未发送给模型。`,
        ));
      }
      const bytes = await readFile(target.canonical);
      if (bytes.includes(0)) {
        return readFailure(root, target.relativePath, bytes.byteLength, "binary", projectDiagnostic(
          "FILE_BINARY",
          "该文件被识别为二进制；文件正文未发送给模型。",
        ));
      }
      const text = decodeUtf8(bytes);
      if (text === null) {
        return readFailure(root, target.relativePath, bytes.byteLength, "unsupported-encoding", projectDiagnostic(
          "FILE_UNSUPPORTED_ENCODING",
          "该文件不是有效 UTF-8 文本；文件正文未发送给模型。",
        ));
      }
      const allLines = splitTextLines(text);
      if (allLines.length === 0) {
        if (input.startLine !== undefined || input.endLine !== undefined) {
          return readFailure(root, target.relativePath, bytes.byteLength, "text", projectDiagnostic(
            "RANGE_INVALID",
            "空文件没有可读取的行范围；文件正文未发送给模型。",
          ));
        }
        return {
          ok: true,
          projectRoot: root,
          path: target.relativePath,
          textStatus: "text",
          encoding: "utf-8",
          lines: [],
          range: null,
          truncated: false,
          bytes: 0,
        };
      }
      const requestedStart = integerOr(input.startLine, 1);
      const requestedEnd = integerOr(input.endLine, allLines.length || 1);
      if (requestedStart < 1 || requestedEnd < requestedStart || requestedStart > allLines.length) {
        return readFailure(root, target.relativePath, bytes.byteLength, "text", projectDiagnostic(
          "RANGE_INVALID",
          "行范围无效；文件正文未发送给模型。",
        ));
      }
      const availableEnd = Math.min(requestedEnd, allLines.length);
      const selected = allLines.slice(requestedStart - 1, availableEnd);
      const lines: Array<{ number: number; text: string }> = [];
      let outputBytes = 0;
      for (let index = 0; index < selected.length && lines.length < MAX_READ_LINES; index += 1) {
        const line = selected[index];
        const nextBytes = Buffer.byteLength(line, "utf8");
        if (outputBytes + nextBytes > MAX_READ_OUTPUT_BYTES) {
          if (lines.length === 0) {
            return readFailure(root, target.relativePath, bytes.byteLength, "too-large", projectDiagnostic(
              "FILE_TOO_LARGE",
              "请求范围首行超过 128 KiB 单次输出上限；该行未发送给模型。",
            ));
          }
          break;
        }
        outputBytes += nextBytes;
        lines.push({ number: requestedStart + index, text: line });
      }
      const actualEnd = lines.length ? lines.at(-1)!.number : Math.min(requestedStart - 1, allLines.length);
      return {
        ok: true,
        projectRoot: root,
        path: target.relativePath,
        textStatus: "text",
        encoding: "utf-8",
        lines,
        range: { startLine: requestedStart, endLine: actualEnd, totalLines: allLines.length },
        truncated: actualEnd < availableEnd || requestedEnd < allLines.length,
        bytes: bytes.byteLength,
      };
    } catch (error) {
      return readFailure(root, path, 0, "text", diagnostic(error));
    }
  }

  async write(
    projectRoot: string,
    input: ProjectWriteInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult> {
    const path = normalizeRelativeDisplay(input.path, false);
    const mode = input.mode ?? "create";
    if (mode !== "create" && mode !== "replace") {
      return changeFailure("create", [path], projectDiagnostic("WRITE_MODE_INVALID", "写入模式必须是 create 或 replace；未写入。"));
    }
    const action = mode;
    let artifact: PreparedArtifact | undefined;
    try {
      throwIfAborted(signal);
      const root = await this.canonicalRoot(projectRoot);
      const target = await this.resolveMutableTarget(root, path, mode === "create" ? "missing" : "file");
      const after = mutationText(input.content, "写入内容");
      const before = mode === "replace" ? await readTextBytes(target.absolute) : Buffer.alloc(0);
      const patch = unifiedTextPatch(target.relativePath, before.toString("utf8"), after.toString("utf8"), action);
      artifact = await this.prepareArtifact(root, context, action, [target.relativePath], before.byteLength, after.byteLength, patch);
      await this.atomicWrite(target, after, mode, before, signal);
      await this.finalizeArtifact(artifact);
      return changeSuccess(action, [target.relativePath], before.byteLength, after.byteLength, artifact.slice);
    } catch (error) {
      if (artifact) await this.discardArtifact(artifact);
      return changeFailure(action, [path], diagnostic(error));
    }
  }

  async edit(
    projectRoot: string,
    input: ProjectEditInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult> {
    const path = normalizeRelativeDisplay(input.path, false);
    let artifact: PreparedArtifact | undefined;
    try {
      throwIfAborted(signal);
      if (!Array.isArray(input.edits) || input.edits.length === 0) {
        throw new ProjectFilesystemError("EDIT_INVALID", "精确编辑至少需要一项替换；未写入。");
      }
      const root = await this.canonicalRoot(projectRoot);
      const target = await this.resolveMutableTarget(root, path, "file");
      const before = await readTextBytes(target.absolute);
      let nextText = before.toString("utf8");
      for (const [index, edit] of input.edits.entries()) {
        if (!edit || typeof edit.oldText !== "string" || typeof edit.newText !== "string"
          || !Number.isInteger(edit.expectedMatches) || edit.expectedMatches < 1 || edit.oldText.length === 0) {
          throw new ProjectFilesystemError("EDIT_INVALID", `第 ${index + 1} 项替换参数无效；全部未写入。`);
        }
        mutationText(edit.oldText, "旧文本");
        mutationText(edit.newText, "新文本");
        const matches = countOccurrences(nextText, edit.oldText);
        if (matches !== edit.expectedMatches) {
          throw new ProjectFilesystemError(
            "EDIT_CONFLICT",
            `第 ${index + 1} 项旧文本期望匹配 ${edit.expectedMatches} 次，实际 ${matches} 次；全部未写入。`,
          );
        }
        nextText = nextText.split(edit.oldText).join(edit.newText);
      }
      const after = mutationText(nextText, "编辑后内容");
      const patch = unifiedTextPatch(target.relativePath, before.toString("utf8"), nextText, "edit");
      artifact = await this.prepareArtifact(root, context, "edit", [target.relativePath], before.byteLength, after.byteLength, patch);
      await this.atomicWrite(target, after, "replace", before, signal);
      await this.finalizeArtifact(artifact);
      return changeSuccess("edit", [target.relativePath], before.byteLength, after.byteLength, artifact.slice);
    } catch (error) {
      if (artifact) await this.discardArtifact(artifact);
      return changeFailure("edit", [path], diagnostic(error));
    }
  }

  async move(
    projectRoot: string,
    input: ProjectMoveInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult> {
    const sourcePath = normalizeRelativeDisplay(input.sourcePath, false);
    const targetPath = normalizeRelativeDisplay(input.targetPath, false);
    let artifact: PreparedArtifact | undefined;
    try {
      throwIfAborted(signal);
      const root = await this.canonicalRoot(projectRoot);
      const source = await this.resolveMutableTarget(root, sourcePath, "any-existing");
      const target = await this.resolveMutableTarget(root, targetPath, "missing");
      const beforeBytes = await this.measureMutationTree(source.absolute, source.relativePath, signal);
      const patch = `rename from ${source.relativePath}\nrename to ${target.relativePath}\n`;
      artifact = await this.prepareArtifact(
        root,
        context,
        "move",
        [source.relativePath, target.relativePath],
        beforeBytes,
        beforeBytes,
        patch,
      );
      await this.options.beforeAtomicCommit?.("move", source.absolute);
      throwIfAborted(signal);
      await this.assertStillMissing(target.absolute);
      await rename(source.absolute, target.absolute);
      const canonicalTarget = await realpath(target.absolute);
      if (!isInside(root, canonicalTarget)) {
        await rename(target.absolute, source.absolute);
        throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "移动后的实际目标超出项目；已回滚。 ");
      }
      await this.finalizeArtifact(artifact);
      return changeSuccess("move", [source.relativePath, target.relativePath], beforeBytes, beforeBytes, artifact.slice);
    } catch (error) {
      if (artifact) await this.discardArtifact(artifact);
      return changeFailure("move", [sourcePath, targetPath], diagnostic(error));
    }
  }

  async delete(
    projectRoot: string,
    input: ProjectDeleteInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult> {
    const path = normalizeRelativeDisplay(input.path, false);
    let artifact: PreparedArtifact | undefined;
    let stagingDirectory: string | undefined;
    try {
      throwIfAborted(signal);
      const root = await this.canonicalRoot(projectRoot);
      const source = await this.resolveMutableTarget(root, path, "any-existing");
      const beforeBytes = await this.measureMutationTree(source.absolute, source.relativePath, signal);
      const sourceMetadata = await lstat(source.absolute);
      const receiptId = randomUUID();
      const recoveryRoot = this.recoveryRoot();
      await mkdir(recoveryRoot, { recursive: true });
      stagingDirectory = join(recoveryRoot, `.pending-${receiptId}`);
      const finalDirectory = join(recoveryRoot, receiptId);
      const payloadPath = join(stagingDirectory, "payload");
      await mkdir(stagingDirectory, { recursive: false });
      await copyTree(source.absolute, payloadPath, sourceMetadata.isDirectory());
      if (!await treesEqual(source.absolute, payloadPath, signal)) {
        throw new ProjectFilesystemError("RECOVERY_FAILED", "恢复副本校验失败；原路径未删除。 ");
      }
      const manifest: RecoveryManifest = {
        receiptId,
        runId: context.runId,
        sessionId: context.sessionId,
        projectRoot: root,
        originalPath: source.relativePath,
        kind: sourceMetadata.isDirectory() ? "directory" : "file",
        beforeBytes,
        status: "available",
        createdAt: Date.now(),
      };
      await writeFile(join(stagingDirectory, "receipt.json"), JSON.stringify(manifest, null, 2), "utf8");
      const beforeText = sourceMetadata.isFile() ? await optionalText(source.absolute) : null;
      const patch = beforeText === null
        ? `deleted ${sourceMetadata.isDirectory() ? "directory" : "binary file"} ${source.relativePath}\n`
        : unifiedTextPatch(source.relativePath, beforeText, "", "delete");
      artifact = await this.prepareArtifact(root, context, "delete", [source.relativePath], beforeBytes, 0, patch);

      const quarantine = join(dirname(source.absolute), `.${basename(source.absolute)}.viniper-delete-${randomUUID()}`);
      await this.options.beforeAtomicCommit?.("delete", source.absolute);
      throwIfAborted(signal);
      await rename(source.absolute, quarantine);
      try {
        if (!await treesEqual(quarantine, payloadPath, signal)) {
          throw new ProjectFilesystemError("FILE_CHANGED", "删除前项目内容发生变化；已回滚且未删除。 ");
        }
        await rename(stagingDirectory, finalDirectory);
        stagingDirectory = undefined;
        try {
          await rm(quarantine, { recursive: true, force: false });
        } catch (cleanupError) {
          await rename(finalDirectory, join(recoveryRoot, `.pending-${receiptId}`));
          await rename(quarantine, source.absolute);
          throw cleanupError;
        }
      } catch (error) {
        if (await pathExists(quarantine) && !await pathExists(source.absolute)) {
          await rename(quarantine, source.absolute);
        }
        throw error;
      }
      await this.finalizeArtifact(artifact);
      return {
        ...changeSuccess("delete", [source.relativePath], beforeBytes, 0, artifact.slice),
        recovery: { receiptId, originalPath: source.relativePath, status: "available" },
      };
    } catch (error) {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
      if (artifact) await this.discardArtifact(artifact);
      return changeFailure("delete", [path], diagnostic(error));
    }
  }

  async restore(
    projectRoot: string,
    input: ProjectRestoreInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectChangeResult> {
    const receiptId = input.receiptId?.trim() ?? "";
    let artifact: PreparedArtifact | undefined;
    let temporaryTarget: string | undefined;
    try {
      throwIfAborted(signal);
      if (!isOpaqueId(receiptId)) throw new ProjectFilesystemError("RECOVERY_NOT_FOUND", "恢复回执不存在或格式无效。 ");
      const root = await this.canonicalRoot(projectRoot);
      const receiptDirectory = join(this.recoveryRoot(), receiptId);
      const manifest = JSON.parse(await readFile(join(receiptDirectory, "receipt.json"), "utf8")) as RecoveryManifest;
      if (!sameCanonicalPath(manifest.projectRoot, root) || manifest.receiptId !== receiptId) {
        throw new ProjectFilesystemError("RECOVERY_NOT_FOUND", "恢复回执不属于当前项目。 ");
      }
      if (manifest.status !== "available") {
        throw new ProjectFilesystemError("RECOVERY_NOT_FOUND", "恢复回执已使用或当前不可恢复。 ");
      }
      const target = await this.resolveMutableTarget(root, manifest.originalPath, "missing", "RESTORE_TARGET_EXISTS");
      const payloadPath = join(receiptDirectory, "payload");
      temporaryTarget = join(dirname(target.absolute), `.${basename(target.absolute)}.viniper-restore-${randomUUID()}`);
      await copyTree(payloadPath, temporaryTarget, manifest.kind === "directory");
      if (!await treesEqual(payloadPath, temporaryTarget, signal)) {
        throw new ProjectFilesystemError("RECOVERY_FAILED", "恢复内容校验失败；项目目标未创建。 ");
      }
      const restoredText = manifest.kind === "file" ? await optionalText(payloadPath) : null;
      const patch = restoredText === null
        ? `restored ${manifest.kind} ${manifest.originalPath}\n`
        : unifiedTextPatch(manifest.originalPath, "", restoredText, "restore");
      artifact = await this.prepareArtifact(root, context, "restore", [manifest.originalPath], 0, manifest.beforeBytes, patch);
      await this.options.beforeAtomicCommit?.("restore", target.absolute);
      throwIfAborted(signal);
      await this.assertStillMissing(target.absolute, "RESTORE_TARGET_EXISTS");
      await commitNoOverwrite(temporaryTarget, target.absolute, manifest.kind === "directory");
      temporaryTarget = undefined;
      const updated: RecoveryManifest = { ...manifest, status: "restored", restoredAt: Date.now() };
      await writeFile(join(receiptDirectory, "receipt.json"), JSON.stringify(updated, null, 2), "utf8");
      await this.finalizeArtifact(artifact);
      return {
        ...changeSuccess("restore", [manifest.originalPath], 0, manifest.beforeBytes, artifact.slice),
        recovery: { receiptId, originalPath: manifest.originalPath, status: "restored" },
      };
    } catch (error) {
      if (temporaryTarget) await rm(temporaryTarget, { recursive: true, force: true });
      if (artifact) await this.discardArtifact(artifact);
      return changeFailure("restore", [], diagnostic(error));
    }
  }

  async diff(
    projectRoot: string,
    input: ProjectDiffInput,
    context: ProjectMutationContext,
    signal?: AbortSignal,
  ): Promise<ProjectDiffResult> {
    try {
      throwIfAborted(signal);
      const root = await this.canonicalRoot(projectRoot);
      const cursor = input.cursor ?? 0;
      if (!Number.isInteger(cursor) || cursor < 0) {
        throw new ProjectFilesystemError("DIFF_CURSOR_INVALID", "差异游标无效；未读取受管输出。 ");
      }
      const maxChars = boundedInteger(input.maxChars, DEFAULT_DIFF_CHARS, 1, MAX_DIFF_CHARS);
      const path = input.path ? validateRelativeMutationPath(input.path, true) : undefined;
      const records = input.artifactId
        ? [await this.loadArtifact(root, input.artifactId)]
        : (await this.listArtifacts(root, context.runId)).filter((item) =>
            !path || item.record.paths.some((candidate) => pathMatches(path, candidate)));
      if (input.artifactId && records.length === 0) {
        throw new ProjectFilesystemError("DIFF_NOT_FOUND", "未找到当前项目的差异引用。 ");
      }
      const artifacts = records.map(({ record }) => artifactSummary(record));
      const selected = records[0];
      const slice = selected ? slicePatch(selected.record, selected.patch, cursor, maxChars) : undefined;
      const paths = [...new Set(artifacts.flatMap((item) => item.paths))];
      return {
        ok: true,
        action: "diff",
        paths,
        beforeBytes: artifacts.reduce((sum, item) => sum + item.beforeBytes, 0),
        afterBytes: artifacts.reduce((sum, item) => sum + item.afterBytes, 0),
        source: "live",
        artifacts,
        ...(slice ? { diff: slice } : {}),
      };
    } catch (error) {
      return diffFailure(diagnostic(error));
    }
  }

  private async resolveMutableTarget(
    root: string,
    inputPath: string,
    expected: "missing" | "file" | "any-existing",
    existsCode: ProjectDiagnosticCode = "PATH_ALREADY_EXISTS",
  ): Promise<MutableTarget> {
    const relativePath = validateRelativeMutationPath(inputPath);
    const lexicalAbsolute = resolve(root, relativePath);
    if (!isInside(root, lexicalAbsolute)) {
      throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "路径超出当前项目；未执行文件变更。 ");
    }
    if (isPrivateRelative(relativePath) || isGitInternalRelative(relativePath)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "该路径属于凭据、私钥或 Git 内部目录；未执行文件变更。 ");
    }
    const lexicalParent = dirname(lexicalAbsolute);
    let canonicalParent: string;
    try {
      canonicalParent = await realpath(lexicalParent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProjectFilesystemError("PATH_NOT_FOUND", "目标父目录不存在；未创建隐式目录。 ");
      }
      throw error;
    }
    if (!isInside(root, canonicalParent) || !sameCanonicalPath(lexicalParent, canonicalParent)) {
      throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "目标父目录经过符号链接解析后不再是原项目路径；未执行文件变更。 ");
    }
    if (await this.isProtectedPath(canonicalParent)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "目标属于 Viniper workstation Preview 受管路径；未执行文件变更。 ");
    }
    const absolute = join(canonicalParent, basename(relativePath));
    if (!isInside(root, absolute) || await this.isProtectedPath(absolute)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "目标属于项目外或 Viniper workstation Preview 受管路径；未执行文件变更。 ");
    }
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (expected === "missing") {
      if (metadata) throw new ProjectFilesystemError(existsCode, "目标已存在；默认不覆盖，未执行文件变更。 ");
      return { root, absolute, relativePath: toRelative(root, absolute), exists: false, isDirectory: false };
    }
    if (!metadata) throw new ProjectFilesystemError("PATH_NOT_FOUND", "项目内未找到该路径；未执行文件变更。 ");
    if (metadata.isSymbolicLink()) {
      throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "状态变更不直接作用于符号链接；未执行文件变更。 ");
    }
    const canonical = await realpath(absolute);
    if (!isInside(root, canonical) || await this.isProtectedPath(canonical)) {
      throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "实际目标超出当前项目；未执行文件变更。 ");
    }
    if (expected === "file" && !metadata.isFile()) {
      throw new ProjectFilesystemError("PATH_NOT_FILE", "该路径不是文本文件；未执行文件变更。 ");
    }
    return {
      root,
      absolute,
      relativePath: toRelative(root, absolute),
      exists: true,
      isDirectory: metadata.isDirectory(),
    };
  }

  private async atomicWrite(
    target: MutableTarget,
    content: Buffer,
    mode: "create" | "replace",
    expectedBefore: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    const temporaryPath = join(dirname(target.absolute), `.${basename(target.absolute)}.viniper-tmp-${randomUUID()}`);
    try {
      const handle = await open(temporaryPath, "wx");
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.options.beforeAtomicCommit?.(mode, target.absolute);
      throwIfAborted(signal);
      const parent = await realpath(dirname(target.absolute));
      if (!isInside(target.root, parent) || await this.isProtectedPath(parent)) {
        throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "提交前目标父目录已改变；未写入。 ");
      }
      if (mode === "create") {
        await this.assertStillMissing(target.absolute);
        try {
          await link(temporaryPath, target.absolute);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new ProjectFilesystemError("PATH_ALREADY_EXISTS", "目标在提交前已出现；未覆盖。 ");
          }
          throw error;
        }
        await unlink(temporaryPath);
      } else {
        const current = await readFile(target.absolute);
        if (!current.equals(expectedBefore)) {
          throw new ProjectFilesystemError("FILE_CHANGED", "文件在提交前已改变；本次替换为零写入。 ");
        }
        await rename(temporaryPath, target.absolute);
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async assertStillMissing(path: string, code: ProjectDiagnosticCode = "PATH_ALREADY_EXISTS"): Promise<void> {
    if (await pathExists(path)) throw new ProjectFilesystemError(code, "目标已存在；未覆盖既有内容。 ");
  }

  private async measureMutationTree(path: string, relativePath: string, signal?: AbortSignal): Promise<number> {
    let entries = 0;
    let bytes = 0;
    const pending: Array<{ absolute: string; relativePath: string }> = [{ absolute: path, relativePath }];
    while (pending.length) {
      throwIfAborted(signal);
      const current = pending.pop()!;
      const metadata = await lstat(current.absolute);
      entries += 1;
      if (entries > MAX_MUTATION_TREE_ENTRIES) {
        throw new ProjectFilesystemError("MUTATION_TOO_LARGE", "目标树超过本次原子变更上限；未执行。 ");
      }
      if (metadata.isSymbolicLink()) {
        throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "目标树包含符号链接；未执行批量状态变更。 ");
      }
      if (isPrivateRelative(current.relativePath) || isGitInternalRelative(current.relativePath)) {
        throw new ProjectFilesystemError("PATH_PROTECTED", "目标树包含凭据、私钥或 Git 内部目录；未执行状态变更。 ");
      }
      if (metadata.isFile()) {
        bytes += metadata.size;
        if (bytes > MAX_MUTATION_TREE_BYTES) {
          throw new ProjectFilesystemError("MUTATION_TOO_LARGE", "目标树超过 64 MiB 可恢复变更上限；未执行。 ");
        }
        continue;
      }
      if (!metadata.isDirectory()) continue;
      for (const child of await readdir(current.absolute, { withFileTypes: true })) {
        pending.push({
          absolute: join(current.absolute, child.name),
          relativePath: joinRelative(current.relativePath, child.name),
        });
      }
    }
    return bytes;
  }

  private async prepareArtifact(
    projectRoot: string,
    context: ProjectMutationContext,
    action: ProjectMutationAction,
    paths: string[],
    beforeBytes: number,
    afterBytes: number,
    patch: string,
  ): Promise<PreparedArtifact> {
    const artifactId = randomUUID();
    const diffRoot = this.diffRoot();
    const pendingDirectory = join(diffRoot, `.pending-${artifactId}`);
    const finalDirectory = join(diffRoot, artifactId);
    const counts = countPatchLines(patch);
    const record: ChangeArtifactRecord = {
      artifactId,
      action,
      paths,
      beforeBytes,
      afterBytes,
      runId: context.runId,
      sessionId: context.sessionId,
      projectRoot,
      createdAt: Date.now(),
      linesAdded: counts.added,
      linesRemoved: counts.removed,
    };
    await mkdir(diffRoot, { recursive: true });
    await mkdir(pendingDirectory, { recursive: false });
    try {
      await writeFile(join(pendingDirectory, "change.patch"), patch, "utf8");
      await writeFile(join(pendingDirectory, "record.json"), JSON.stringify(record, null, 2), "utf8");
    } catch (error) {
      await rm(pendingDirectory, { recursive: true, force: true });
      throw error;
    }
    return {
      record,
      pendingDirectory,
      finalDirectory,
      slice: slicePatch(record, patch, 0, DEFAULT_DIFF_CHARS),
    };
  }

  private async finalizeArtifact(artifact: PreparedArtifact): Promise<void> {
    try {
      await rename(artifact.pendingDirectory, artifact.finalDirectory);
    } catch {
      // The pending directory remains a readable managed artifact. A project
      // mutation must not be repeated merely because final naming failed.
    }
  }

  private async discardArtifact(artifact: PreparedArtifact): Promise<void> {
    await rm(artifact.pendingDirectory, { recursive: true, force: true });
    await rm(artifact.finalDirectory, { recursive: true, force: true });
  }

  private async loadArtifact(projectRoot: string, artifactId: string): Promise<{ record: ChangeArtifactRecord; patch: string }> {
    if (!isOpaqueId(artifactId)) throw new ProjectFilesystemError("DIFF_NOT_FOUND", "差异引用格式无效。 ");
    const root = this.diffRoot();
    for (const directory of [join(root, artifactId), join(root, `.pending-${artifactId}`)]) {
      try {
        const record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as ChangeArtifactRecord;
        if (record.artifactId !== artifactId || !sameCanonicalPath(record.projectRoot, projectRoot)) continue;
        return { record, patch: await readFile(join(directory, "change.patch"), "utf8") };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new ProjectFilesystemError("DIFF_NOT_FOUND", "未找到当前项目的差异引用。 ");
  }

  private async listArtifacts(projectRoot: string, runId: string): Promise<Array<{ record: ChangeArtifactRecord; patch: string }>> {
    let directories: string[];
    try {
      directories = await readdir(this.diffRoot());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: Array<{ record: ChangeArtifactRecord; patch: string }> = [];
    for (const name of directories) {
      const directory = join(this.diffRoot(), name);
      try {
        const record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as ChangeArtifactRecord;
        if (record.runId !== runId || !sameCanonicalPath(record.projectRoot, projectRoot)) continue;
        records.push({ record, patch: await readFile(join(directory, "change.patch"), "utf8") });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return records.sort((left, right) => left.record.createdAt - right.record.createdAt);
  }

  private diffRoot(): string {
    if (!this.options.managedRoot) {
      throw new ProjectFilesystemError("RECOVERY_FAILED", "P2 受管输出根未配置；未执行文件变更。 ");
    }
    return join(resolve(this.options.managedRoot), "project-diffs");
  }

  private recoveryRoot(): string {
    if (!this.options.managedRoot) {
      throw new ProjectFilesystemError("RECOVERY_FAILED", "P2 可恢复区未配置；未执行删除。 ");
    }
    return join(resolve(this.options.managedRoot), "project-recovery");
  }

  private async canonicalRoot(projectRoot: string): Promise<string> {
    try {
      const canonical = await realpath(resolve(projectRoot));
      const metadata = await stat(canonical);
      if (!metadata.isDirectory()) throw new ProjectFilesystemError("PROJECT_NOT_DIRECTORY", "项目根不再是目录。");
      if (await this.isProtectedPath(canonical)) {
        throw new ProjectFilesystemError("PATH_PROTECTED", "项目根属于 Viniper workstation Preview 受管数据。");
      }
      return canonical;
    } catch (error) {
      if (error instanceof ProjectFilesystemError) throw error;
      throw new ProjectFilesystemError("PROJECT_NOT_READABLE", "项目根当前不可读取。");
    }
  }

  private async resolveTarget(
    root: string,
    inputPath: string,
    expected: "file" | "directory" | "any",
  ): Promise<ResolvedTarget> {
    if (isAbsolute(inputPath) || inputPath.split(/[\\/]+/u).includes("..")) {
      throw new ProjectFilesystemError("PATH_INVALID", "只接受项目内相对路径；该路径未发送给模型。");
    }
    const absolute = resolve(root, inputPath === "." ? "" : inputPath);
    if (!isInside(root, absolute)) {
      throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "路径超出当前项目；该文件未发送给模型。");
    }
    const lexicalRelative = toRelative(root, absolute);
    if (isPrivateRelative(lexicalRelative) || isGitInternalRelative(lexicalRelative)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "该路径属于凭据、私钥或 Git 内部目录；该文件未发送给模型。");
    }
    if (await this.isProtectedPath(absolute)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "该路径属于 Viniper workstation Preview 受管数据；该文件未发送给模型。");
    }
    let canonical;
    try {
      canonical = await realpath(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProjectFilesystemError("PATH_NOT_FOUND", "项目内未找到该路径；没有文件内容发送给模型。");
      }
      throw new ProjectFilesystemError("PROJECT_NOT_READABLE", "该项目路径不可读取；没有文件内容发送给模型。");
    }
    if (!isInside(root, canonical)) {
      throw new ProjectFilesystemError("PATH_OUTSIDE_PROJECT", "符号链接目标超出当前项目；该文件未发送给模型。");
    }
    const canonicalRelative = toRelative(root, canonical);
    if (isPrivateRelative(canonicalRelative) || isGitInternalRelative(canonicalRelative) || await this.isProtectedPath(canonical)) {
      throw new ProjectFilesystemError("PATH_PROTECTED", "该路径属于受保护内容；该文件未发送给模型。");
    }
    const metadata = await stat(canonical);
    if (expected === "file" && !metadata.isFile()) {
      throw new ProjectFilesystemError("PATH_NOT_FILE", "该路径不是文本文件；没有文件内容发送给模型。");
    }
    if (expected === "directory" && !metadata.isDirectory()) {
      throw new ProjectFilesystemError("PATH_NOT_DIRECTORY", "该路径不是目录；没有目录内容发送给模型。");
    }
    return { root, absolute, canonical, relativePath: lexicalRelative };
  }

  private async isProtectedPath(path: string): Promise<boolean> {
    const resolvedPath = resolve(path);
    if (this.workspaceRoots.some((workspaceRoot) => isInside(workspaceRoot, resolvedPath))) return false;
    const protectedRoots = await (this.protectedRootsPromise ??= Promise.all(
      (this.options.protectedRoots ?? []).map(async (root) => {
        try { return await realpath(resolve(root)); } catch { return resolve(root); }
      }),
    ));
    return protectedRoots.some((protectedRoot) => isInside(protectedRoot, resolvedPath));
  }
}

function validateRelativeMutationPath(path: string, allowRoot = false): string {
  const value = normalizeRelativeDisplay(path, false);
  if (!value || (!allowRoot && value === ".") || isAbsolute(value) || value.split(/[\\/]+/u).includes("..")) {
    throw new ProjectFilesystemError("PATH_INVALID", "只接受项目内规范相对路径；未执行文件变更。 ");
  }
  const normalized = value.replace(/\\/gu, "/");
  if (isPrivateRelative(normalized) || isGitInternalRelative(normalized)) {
    throw new ProjectFilesystemError("PATH_PROTECTED", "该路径属于凭据、私钥或 Git 内部目录；未执行文件变更。 ");
  }
  return normalized;
}

function mutationText(value: unknown, label: string): Buffer {
  if (typeof value !== "string") {
    throw new ProjectFilesystemError("EDIT_INVALID", `${label}必须是 UTF-8 文本；未写入。`);
  }
  if (value.includes("\0")) {
    throw new ProjectFilesystemError("FILE_BINARY", `${label}包含二进制空字节；未写入。`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > MAX_MUTATION_TEXT_BYTES) {
    throw new ProjectFilesystemError("MUTATION_TOO_LARGE", `${label}超过 512 KiB 单次原子变更上限；未写入。`);
  }
  return bytes;
}

async function readTextBytes(path: string): Promise<Buffer> {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_MUTATION_TEXT_BYTES) {
    throw new ProjectFilesystemError("MUTATION_TOO_LARGE", "现有文件超过 512 KiB 单次原子变更上限；未写入。 ");
  }
  if (decodeUtf8(bytes) === null) {
    throw new ProjectFilesystemError("FILE_BINARY", "现有文件不是有效 UTF-8 文本；未写入。 ");
  }
  return bytes;
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - search.length) {
    const index = text.indexOf(search, offset);
    if (index < 0) break;
    count += 1;
    offset = index + search.length;
  }
  return count;
}

function unifiedTextPatch(
  path: string,
  before: string,
  after: string,
  action: ProjectMutationAction,
): string {
  const beforePath = action === "create" || action === "restore" ? "/dev/null" : `a/${path}`;
  const afterPath = action === "delete" ? "/dev/null" : `b/${path}`;
  const beforeLines = textLinesForPatch(before);
  const afterLines = textLinesForPatch(after);
  return [
    `--- ${beforePath}`,
    `+++ ${afterPath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function textLinesForPatch(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function countPatchLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function slicePatch(
  record: ChangeArtifactRecord,
  patch: string,
  cursor: number,
  maxChars: number,
): ProjectDiffSlice {
  if (cursor > patch.length) {
    throw new ProjectFilesystemError("DIFF_CURSOR_INVALID", "差异游标超过完整 patch 长度；未返回内容。 ");
  }
  const end = Math.min(patch.length, cursor + maxChars);
  return {
    artifactId: record.artifactId,
    patch: patch.slice(cursor, end),
    truncated: end < patch.length,
    nextCursor: end < patch.length ? end : null,
    summary: {
      filesChanged: 1,
      linesAdded: record.linesAdded,
      linesRemoved: record.linesRemoved,
    },
  };
}

function changeSuccess(
  action: ProjectMutationAction,
  paths: string[],
  beforeBytes: number,
  afterBytes: number,
  diff: ProjectDiffSlice,
): ProjectChangeResult {
  return { ok: true, action, paths, beforeBytes, afterBytes, source: "live", diff };
}

function changeFailure(
  action: ProjectMutationAction,
  paths: string[],
  error: ProjectDiagnostic,
): ProjectChangeResult {
  return { ok: false, action, paths, beforeBytes: 0, afterBytes: 0, source: "live", error };
}

function diffFailure(error: ProjectDiagnostic): ProjectDiffResult {
  return {
    ok: false,
    action: "diff",
    paths: [],
    beforeBytes: 0,
    afterBytes: 0,
    source: "live",
    artifacts: [],
    error,
  };
}

function artifactSummary(record: ChangeArtifactRecord): ProjectDiffArtifactSummary {
  return {
    artifactId: record.artifactId,
    action: record.action,
    paths: [...record.paths],
    beforeBytes: record.beforeBytes,
    afterBytes: record.afterBytes,
  };
}

async function copyTree(source: string, target: string, directory: boolean): Promise<void> {
  if (directory) {
    await cp(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    return;
  }
  await copyFile(source, target, constants.COPYFILE_EXCL);
}

async function treesEqual(left: string, right: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal);
  const [leftMetadata, rightMetadata] = await Promise.all([lstat(left), lstat(right)]);
  if (leftMetadata.isFile() !== rightMetadata.isFile() || leftMetadata.isDirectory() !== rightMetadata.isDirectory()) {
    return false;
  }
  if (leftMetadata.isFile()) {
    if (leftMetadata.size !== rightMetadata.size) return false;
    const [leftBytes, rightBytes] = await Promise.all([readFile(left), readFile(right)]);
    return leftBytes.equals(rightBytes);
  }
  if (!leftMetadata.isDirectory()) return false;
  const [leftNames, rightNames] = await Promise.all([readdir(left), readdir(right)]);
  leftNames.sort((a, b) => a.localeCompare(b, "en"));
  rightNames.sort((a, b) => a.localeCompare(b, "en"));
  if (leftNames.length !== rightNames.length || leftNames.some((name, index) => name !== rightNames[index])) return false;
  for (const name of leftNames) {
    if (!await treesEqual(join(left, name), join(right, name), signal)) return false;
  }
  return true;
}

async function optionalText(path: string): Promise<string | null> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_MUTATION_TEXT_BYTES) return null;
  return decodeUtf8(await readFile(path));
}

async function commitNoOverwrite(source: string, target: string, directory: boolean): Promise<void> {
  if (directory) {
    if (await pathExists(target)) {
      throw new ProjectFilesystemError("RESTORE_TARGET_EXISTS", "恢复目标已存在；未覆盖且恢复副本仍保留。 ");
    }
    await rename(source, target);
    return;
  }
  try {
    await link(source, target);
    await unlink(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ProjectFilesystemError("RESTORE_TARGET_EXISTS", "恢复目标已存在；未覆盖且恢复副本仍保留。 ");
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isOpaqueId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function sameCanonicalPath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight;
}

function pathMatches(filter: string, candidate: string): boolean {
  return filter === "." || candidate === filter || candidate.startsWith(`${filter}/`) || filter.startsWith(`${candidate}/`);
}

function normalizeRelativeDisplay(path: string | undefined, allowDefault = true): string {
  const value = path?.trim();
  if (!value) return allowDefault ? "." : "";
  return value.replace(/\\/gu, "/");
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)));
}

function integerOr(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) ? value! : fallback;
}

function isInside(root: string, candidate: string): boolean {
  const comparisonRoot = process.platform === "win32" ? root.toLocaleLowerCase("en-US") : root;
  const comparisonCandidate = process.platform === "win32" ? candidate.toLocaleLowerCase("en-US") : candidate;
  const pathFromRoot = relative(comparisonRoot, comparisonCandidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

function toRelative(root: string, candidate: string): string {
  const output = relative(root, candidate).split(sep).join("/");
  return output || ".";
}

function joinRelative(parent: string, child: string): string {
  return parent === "." ? child : `${parent}/${child}`;
}

function isNoiseRelative(path: string): boolean {
  const segments = path.toLocaleLowerCase("en-US").split("/");
  if (segments.some((segment) => NOISE_DIRECTORY_NAMES.has(segment))) return true;
  return segments.some((segment, index) => segment === "运行残留" && segments[index - 1] === "codex");
}

function isGitInternalRelative(path: string): boolean {
  const segments = path.toLocaleLowerCase("en-US").split("/");
  return segments.includes(".git");
}

function isPrivateRelative(path: string): boolean {
  const name = basename(path).toLocaleLowerCase("en-US");
  if (PUBLIC_ENV_TEMPLATE_BASENAMES.has(name)) return false;
  return PRIVATE_BASENAMES.has(name)
    || PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function decodeUtf8(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function splitTextLines(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function snippet(line: string): string {
  const normalized = line.trim().replace(/\s+/gu, " ");
  return normalized.length <= MAX_SNIPPET_CHARS ? normalized : `${normalized.slice(0, MAX_SNIPPET_CHARS - 1)}…`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("PROJECT_TOOL_CANCELLED");
}

function diagnostic(error: unknown): ProjectDiagnostic {
  if (error instanceof ProjectFilesystemError) return projectDiagnostic(error.code, error.message);
  if (error instanceof Error && error.message === "PROJECT_TOOL_CANCELLED") throw error;
  return projectDiagnostic("PROJECT_NOT_READABLE", "项目内容当前不可读取；没有文件内容发送给模型。");
}

function projectDiagnostic(code: ProjectDiagnosticCode, message: string): ProjectDiagnostic {
  return { code, message, sentToModel: false };
}

function listFailure(root: string, path: string, limit: number, error: ProjectDiagnostic): ProjectListResult {
  return { ok: false, projectRoot: root, path, entries: [], limit, truncated: false, blockedCount: 0, error };
}

function searchFailure(
  root: string,
  query: string,
  path: string,
  maxResults: number,
  error: ProjectDiagnostic,
): ProjectSearchResult {
  return {
    ok: false,
    projectRoot: root,
    query,
    path,
    results: [],
    maxResults,
    scannedFiles: 0,
    truncated: false,
    source: "live",
    error,
  };
}

function readFailure(
  root: string,
  path: string,
  bytes: number,
  status: ProjectReadResult["textStatus"],
  error: ProjectDiagnostic,
): ProjectReadResult {
  return {
    ok: false,
    projectRoot: root,
    path,
    textStatus: status,
    encoding: null,
    lines: [],
    range: null,
    truncated: false,
    bytes,
    error,
  };
}
