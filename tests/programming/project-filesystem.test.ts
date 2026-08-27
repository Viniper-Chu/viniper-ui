import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

interface Diagnostic {
  code: string;
  message: string;
  sentToModel: false;
}

interface ListResult {
  ok: boolean;
  projectRoot: string;
  path: string;
  entries: Array<{ name: string; type: string; path: string }>;
  limit: number;
  truncated: boolean;
  blockedCount: number;
  error?: Diagnostic;
}

interface SearchResult {
  ok: boolean;
  projectRoot: string;
  results: Array<{
    path: string;
    line: number | null;
    snippet: string;
    match: "path" | "text";
    source: "live";
  }>;
  truncated: boolean;
  source: "live";
  error?: Diagnostic;
}

interface ReadResult {
  ok: boolean;
  projectRoot: string;
  path: string;
  textStatus: "text" | "binary" | "unsupported-encoding" | "too-large";
  encoding: "utf-8" | null;
  lines: Array<{ number: number; text: string }>;
  range: { startLine: number; endLine: number; totalLines: number } | null;
  truncated: boolean;
  bytes: number;
  error?: Diagnostic;
}

interface ProjectFilesystem {
  canonicalizeProjectRoot(path: string): Promise<string>;
  list(projectRoot: string, input: { path?: string; limit?: number }, signal?: AbortSignal): Promise<ListResult>;
  search(projectRoot: string, input: { query: string; path?: string; maxResults?: number }, signal?: AbortSignal): Promise<SearchResult>;
  read(projectRoot: string, input: { path: string; startLine?: number; endLine?: number }, signal?: AbortSignal): Promise<ReadResult>;
}

type ProjectFilesystemConstructor = new (options?: { protectedRoots?: string[] }) => ProjectFilesystem;

function loadProjectFilesystem(): ProjectFilesystemConstructor {
  const loaded = require("../../src/platform/filesystem/node-project-filesystem") as {
    NodeProjectFilesystem: ProjectFilesystemConstructor;
  };
  return loaded.NodeProjectFilesystem;
}

async function fixture(): Promise<{
  root: string;
  outside: string;
  filesystem: ProjectFilesystem;
  dispose(): Promise<void>;
}> {
  const ProjectFilesystem = loadProjectFilesystem();
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const root = await mkdtemp(join(residue, "p1-project-"));
  const outside = await mkdtemp(join(residue, "p1-outside-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), "alpha\nneedle middle\nomega\n", "utf8");
  await writeFile(join(root, "src", "fact.ts"), "export const first = 1;\nexport const needle = 'P1';\n", "utf8");
  await writeFile(join(root, "needle-path.txt"), "path-only evidence\n", "utf8");
  await writeFile(join(root, "large.txt"), `${"line\n".repeat(1200)}`, "utf8");
  await writeFile(join(root, "long-single-line.txt"), "长".repeat(50_000), "utf8");
  await writeFile(join(root, "empty.txt"), "", "utf8");
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  await writeFile(join(root, ".env"), "PRIVATE_MARKER=never-send-this\n", "utf8");
  await writeFile(join(root, ".env.local"), "LOCAL_PRIVATE_MARKER=never-send-this\n", "utf8");
  await writeFile(join(root, ".env.docs"), "DOCUMENTATION_TEMPLATE=value\n", "utf8");
  await writeFile(join(root, ".env.example"), "PUBLIC_TEMPLATE=value\n", "utf8");
  await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=never-send-this\n", "utf8");
  await writeFile(join(root, "windows-private.ppk"), "PuTTY-User-Key-File-3: ssh-ed25519\nPRIVATE_MARKER=never-send-this\n", "utf8");
  await writeFile(join(root, ".gitignore"), "dist/\n", "utf8");
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "config"), "[remote]\nurl=private\n", "utf8");
  await writeFile(join(outside, "outside.txt"), "outside marker", "utf8");
  await symlink(outside, join(root, "outside-link"), "junction");
  return {
    root,
    outside,
    filesystem: new ProjectFilesystem(),
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    },
  };
}

test("P1-02 project.list returns direct children with a visible limit and no credential entries", async () => {
  const scene = await fixture();
  try {
    const canonical = await scene.filesystem.canonicalizeProjectRoot(scene.root);
    const result = await scene.filesystem.list(canonical, { limit: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.projectRoot, canonical);
    assert.equal(result.entries.length, 2);
    assert.equal(result.truncated, true);
    assert.equal(result.limit, 2);
    assert.equal(result.entries.every((entry) => !entry.path.includes("/")), true, "only direct children");
    assert.equal(result.entries.some((entry) => entry.name === ".env"), false);
    assert.equal(result.blockedCount >= 1, true);
  } finally {
    await scene.dispose();
  }
});

test("P1-03 project.search returns live path and text evidence only from the selected root", async () => {
  const scene = await fixture();
  try {
    const root = await scene.filesystem.canonicalizeProjectRoot(scene.root);
    const heavy = join(scene.root, "aaa-heavy");
    await mkdir(heavy);
    await Promise.all(Array.from({ length: 33 }, (_, index) =>
      writeFile(join(heavy, `payload-${String(index).padStart(2, "0")}.txt`), Buffer.alloc(256 * 1024, 97))));
    const rootPriority = await scene.filesystem.search(root, { query: "needle middle", maxResults: 20 });
    assert.equal(rootPriority.results.some((item) => item.path === "README.md" && item.match === "text"), true);
    await rm(heavy, { recursive: true, force: true });

    const result = await scene.filesystem.search(root, { query: "needle", maxResults: 20 });
    assert.equal(result.ok, true);
    assert.equal(result.source, "live");
    assert.deepEqual(result.results.map((item) => [item.path, item.line, item.match, item.source]), [
      ["needle-path.txt", null, "path", "live"],
      ["README.md", 2, "text", "live"],
      ["src/fact.ts", 2, "text", "live"],
    ]);
    assert.equal(result.results.some((item) => item.match === "path"), true);
    assert.equal(result.results.some((item) => item.match === "text"), true);
    assert.equal(result.results.every((item) => !item.path.includes("outside")), true);

    const bounded = await scene.filesystem.search(root, { query: "needle", maxResults: 1 });
    assert.equal(bounded.results.length, 1);
    assert.equal(bounded.truncated, true);
  } finally {
    await scene.dispose();
  }
});

test("P1-04 project.read preserves line numbers and keeps large or binary input bounded", async () => {
  const scene = await fixture();
  try {
    const root = await scene.filesystem.canonicalizeProjectRoot(scene.root);
    const ranged = await scene.filesystem.read(root, { path: "README.md", startLine: 2, endLine: 3 });
    assert.equal(ranged.ok, true);
    assert.equal(ranged.encoding, "utf-8");
    assert.deepEqual(ranged.lines, [
      { number: 2, text: "needle middle" },
      { number: 3, text: "omega" },
    ]);
    assert.deepEqual(ranged.range, { startLine: 2, endLine: 3, totalLines: 3 });

    const large = await scene.filesystem.read(root, { path: "large.txt" });
    assert.equal(large.ok, true);
    assert.equal(large.truncated, true);
    assert.equal(large.lines.length <= 400, true);

    const longSingleLine = await scene.filesystem.read(root, { path: "long-single-line.txt" });
    assert.equal(longSingleLine.ok, false);
    assert.equal(longSingleLine.error?.code, "FILE_TOO_LARGE");
    assert.deepEqual(longSingleLine.lines, []);
    assert.equal(longSingleLine.range, null);

    const binary = await scene.filesystem.read(root, { path: "binary.bin" });
    assert.equal(binary.ok, false);
    assert.equal(binary.textStatus, "binary");
    assert.deepEqual(binary.lines, []);

    const empty = await scene.filesystem.read(root, { path: "empty.txt" });
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.lines, []);
    assert.equal(empty.range, null);

    const beyondEnd = await scene.filesystem.read(root, { path: "README.md", startLine: 99 });
    assert.equal(beyondEnd.ok, false);
    assert.equal(beyondEnd.error?.code, "RANGE_INVALID");
    assert.equal(beyondEnd.range, null);
  } finally {
    await scene.dispose();
  }
});

test("P1-05 exact secret paths are blocked without hiding common templates or root Git metadata", async () => {
  const scene = await fixture();
  try {
    const root = await scene.filesystem.canonicalizeProjectRoot(scene.root);
    const template = await scene.filesystem.read(root, { path: ".env.example" });
    assert.equal(template.ok, true);
    assert.equal(template.lines[0]?.text, "PUBLIC_TEMPLATE=value");
    const documentationTemplate = await scene.filesystem.read(root, { path: ".env.docs" });
    assert.equal(documentationTemplate.ok, true);
    assert.equal(documentationTemplate.lines[0]?.text, "DOCUMENTATION_TEMPLATE=value");

    const gitignore = await scene.filesystem.read(root, { path: ".gitignore" });
    assert.equal(gitignore.ok, true);

    for (const path of [".npmrc", ".git/config"]) {
      const blocked = await scene.filesystem.read(root, { path });
      assert.equal(blocked.ok, false, path);
      assert.equal(blocked.error?.code, "PATH_PROTECTED", path);
      assert.equal(blocked.error?.sentToModel, false, path);
      assert.doesNotMatch(JSON.stringify(blocked), /never-send-this|url=private/u, path);
    }
  } finally {
    await scene.dispose();
  }
});

test("P1-06 path escapes, external links and credential files return diagnostics without content", async () => {
  const scene = await fixture();
  try {
    const root = await scene.filesystem.canonicalizeProjectRoot(scene.root);
    for (const path of ["../outside.txt", join(scene.outside, "outside.txt"), "outside-link/outside.txt", ".env", ".env.local", "windows-private.ppk"]) {
      const result = await scene.filesystem.read(root, { path });
      assert.equal(result.ok, false, path);
      assert.equal(result.error?.sentToModel, false, path);
      assert.match(result.error?.message ?? "", /未发送给模型/u, path);
      assert.doesNotMatch(JSON.stringify(result), /never-send-this|outside marker/u, path);
    }
    const search = await scene.filesystem.search(root, { query: "never-send-this" });
    assert.equal(search.ok, true);
    assert.deepEqual(search.results, []);
    assert.doesNotMatch(JSON.stringify(search), /PRIVATE_MARKER/u);
  } finally {
    await scene.dispose();
  }
});
