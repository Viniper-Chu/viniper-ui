import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageLegacyUi } from "./stage-legacy-ui.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexRoot = resolve(repositoryRoot, "codex");
const outputRoot = join(codexRoot, "工作输出", "viniper-workstation-implementation-20260817", "packages", "portable");
const residueRoot = join(codexRoot, "运行残留");
const stageRoot = join(residueRoot, "viniper-workstation-portable-stage");
const portableFolderName = "Viniper-workstation-win32-x64";
const stagePortable = join(stageRoot, portableFolderName);
const finalPortable = join(outputRoot, portableFolderName);
const zipPath = join(outputRoot, `${portableFolderName}.zip`);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(`Windows portable 只允许在 win32/x64 构建；当前为 ${process.platform}/${process.arch}。`);
}

await safeReset(stageRoot, residueRoot);
await mkdir(stageRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });
await safeReset(finalPortable, outputRoot);
await safeRemoveFile(zipPath, outputRoot);

const electronDistribution = join(repositoryRoot, "node_modules", "electron", "dist");
await access(join(electronDistribution, "electron.exe"));
await access(join(repositoryRoot, "dist", "src", "platform", "desktop", "main.js"));

await cp(electronDistribution, stagePortable, { recursive: true });
await rename(join(stagePortable, "electron.exe"), join(stagePortable, "Viniper workstation.exe"));

const applicationRoot = join(stagePortable, "resources", "app");
await mkdir(applicationRoot, { recursive: true });
const stagedLegacyUi = await stageLegacyUi({ repositoryRoot, stagePortable });
// Keep the installer-validated branding manifest inside the self-contained
// app payload; runtime/static assets remain under resources/viniper-ui.
await cp(join(repositoryRoot, "assets", "branding"), join(applicationRoot, "assets", "branding"), { recursive: true });

const sourcePackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const brandingManifest = JSON.parse(await readFile(join(repositoryRoot, "assets", "branding", "manifest.json"), "utf8"));
const brandingAsset = (name) => ["resources/viniper-ui/static/assets", name].join("/");
await writeFile(join(applicationRoot, "package.json"), `${JSON.stringify({
  name: "viniper-workstation-preview",
  version: sourcePackage.version,
  private: true,
  main: "main.js",
}, null, 2)}\n`, "utf8");
await writeFile(join(applicationRoot, "portable-manifest.json"), `${JSON.stringify({
  product: "Viniper workstation",
  version: sourcePackage.version,
  releaseStage: "Preview（预览版）",
  platform: "win32",
  architecture: "x64",
  capabilities: ["P2", "P3", "P4", "native-tray"],
  entry: "main.js",
  runtimeAssets: "resources/viniper-ui",
  icon: {
    runtime: brandingAsset(brandingManifest.nativeFallback),
    tray: brandingAsset(brandingManifest.nativeSmall),
    windowsIco: brandingAsset(brandingManifest.windowsIco),
    pngRuntimeVerified: true,
    icoRuntimeVerified: true,
  },
}, null, 2)}\n`, "utf8");

await cp(stagePortable, finalPortable, { recursive: true });
const archive = spawnSync("tar.exe", [
  "-a", "-c", "-f", zipPath,
  "-C", outputRoot,
  portableFolderName,
], {
  cwd: repositoryRoot,
  encoding: "utf8",
  windowsHide: true,
});
if (archive.status !== 0) {
  throw new Error(`便携压缩包创建失败：${archive.stderr || archive.stdout || "tar.exe 未提供详情"}`);
}

await safeReset(stageRoot, residueRoot);
process.stdout.write(`${JSON.stringify({
  status: "PORTABLE_READY",
  executable: join(finalPortable, "Viniper workstation.exe"),
  application: join(finalPortable, "resources", "app"),
  archive: zipPath,
})}\n`);

async function safeReset(target, expectedParent) {
  assertDirectChild(target, expectedParent);
  await rm(target, { recursive: true, force: true });
}

async function safeRemoveFile(target, expectedParent) {
  assertDirectChild(target, expectedParent);
  await rm(target, { force: true });
}

function assertDirectChild(target, expectedParent) {
  if (resolve(dirname(target)) !== resolve(expectedParent)) {
    throw new Error(`拒绝清理非预期路径：${target}`);
  }
}
