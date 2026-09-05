import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageLegacyUi } from "./stage-legacy-ui.mjs";

// Windows Preview packaging is intentionally a native electron-builder/NSIS
// flow. The portable tree remains useful for diagnostics, but Setup is a real
// per-user installer with an uninstall entry point.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repositoryRoot, "resources", "viniper-ui", "desktop");
const codexRoot = resolve(repositoryRoot, "..", "..", "codex");
const outputRoot = resolve(process.env.VINIPER_WINDOWS_PREVIEW_OUTPUT_ROOT
  || join(codexRoot, "工作输出", "viniper-workstation-implementation-20260817", "packages", "windows-preview"));
const residueRoot = resolve(process.env.VINIPER_WINDOWS_PREVIEW_RESIDUE_ROOT || join(codexRoot, "运行残留"));
const stageRoot = join(residueRoot, "viniper-workstation-windows-preview-stage");
const builderRoot = join(residueRoot, "viniper-workstation-electron-builder");
const portableFolderName = "Viniper-workstation-win32-x64";
const stagePortable = join(stageRoot, portableFolderName);
const finalPortable = join(outputRoot, portableFolderName);
const zipPath = join(outputRoot, `${portableFolderName}.zip`);
const installerPath = join(outputRoot, "Viniper-workstation-Preview-Setup.exe");
const builderConfigPath = join(residueRoot, "viniper-workstation-electron-builder.json");
const builderTimeoutMs = Number(process.env.VINIPER_ELECTRON_BUILDER_TIMEOUT_MS || 1_200_000);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(`Windows x64 Preview 只允许在 win32/x64 构建；当前为 ${process.platform}/${process.arch}。`);
}

const sourcePackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(sourcePackage.version)) {
  throw new Error(`Windows Preview 需要有效语义版本，当前为 ${sourcePackage.version}。`);
}
const profile = JSON.parse(await readFile(join(repositoryRoot, "resources", "viniper-ui", "profiles.json"), "utf8")).preview;
if (!profile || profile.port !== 17947 || profile.app_id !== "com.viniper.workstation.preview") {
  throw new Error("Preview profile 必须保持独立 appId/17947 端口边界。");
}

await safeReset(stageRoot, residueRoot);
await safeReset(builderRoot, residueRoot);
await mkdir(stageRoot, { recursive: true });
await mkdir(builderRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });
await safeReset(finalPortable, outputRoot);
await safeRemoveFile(zipPath, outputRoot);
await safeRemoveFile(installerPath, outputRoot);
await safeRemoveFile(builderConfigPath, residueRoot);

const electronDistribution = join(repositoryRoot, "node_modules", "electron", "dist");
await access(join(electronDistribution, "electron.exe"));
await access(join(repositoryRoot, "dist", "src", "platform", "desktop", "main.js"));
const electronBuilder = join(desktopRoot, "node_modules", ".bin", "electron-builder.cmd");
await access(electronBuilder);

await cp(electronDistribution, stagePortable, { recursive: true });
await rename(join(stagePortable, "electron.exe"), join(stagePortable, "Viniper workstation.exe"));
// --prepackaged skips electron-builder's resource-editing phase entirely.
// Brand this one staged executable before either portable or NSIS consumes it.
await brandWindowsExecutable(join(stagePortable, "Viniper workstation.exe"), sourcePackage.version);
const applicationRoot = join(stagePortable, "resources", "app");
await mkdir(applicationRoot, { recursive: true });
await stageLegacyUi({ repositoryRoot, stagePortable, desktopProfile: "preview" });
await cp(join(repositoryRoot, "assets", "branding"), join(applicationRoot, "assets", "branding"), { recursive: true });

const brandingManifest = JSON.parse(await readFile(join(repositoryRoot, "assets", "branding", "manifest.json"), "utf8"));
const brandingAsset = (name) => ["resources/viniper-ui/static/assets", name].join("/");
await writeFile(join(applicationRoot, "package.json"), `${JSON.stringify({
  name: "viniper-workstation-preview",
  version: sourcePackage.version,
  private: true,
  main: "main.js",
  viniperProfile: "preview",
}, null, 2)}\n`, "utf8");
await writeFile(join(applicationRoot, "portable-manifest.json"), `${JSON.stringify({
  product: "Viniper workstation",
  version: sourcePackage.version,
  releaseStage: "Preview（预览版）",
  platform: "win32",
  architecture: "x64",
  capabilities: [
    "sessions", "multi-run", "coordination", "token-cache", "scheduler", "skills", "mcp-plugin",
    "provider-settings", "local-models", "memory", "context-compaction", "project-index", "artifacts",
    "data-transfer", "credential-transfer", "diagnostics", "updates", "settings", "P1", "P2", "P3", "P4",
    "native-tray",
  ],
  entry: "main.js",
  runtimeAssets: "resources/viniper-ui",
  icon: {
    runtime: brandingAsset(brandingManifest.nativeFallback),
    tray: brandingAsset(brandingManifest.nativeSmall),
    windowsIco: brandingAsset(brandingManifest.windowsIco),
    pngRuntimeVerified: true,
    icoRuntimeVerified: true,
  },
  userInstall: {
    defaultDirectory: "%LOCALAPPDATA%\\Programs\\Viniper workstation Preview",
    desktopShortcut: "Viniper workstation.lnk",
    services: false,
    scheduledTasks: false,
    startup: false,
    fileAssociations: false,
    machineRegistry: false,
  },
}, null, 2)}\n`, "utf8");

await cp(stagePortable, finalPortable, { recursive: true });
await createZip(zipPath, outputRoot, portableFolderName);

// Build Setup directly from the staged self-contained app. A non-one-click
// per-user NSIS target supports /S /D="<isolated root>" for reversible tests.
const builderConfig = {
  appId: profile.app_id,
  productName: profile.product_name,
  directories: { output: builderRoot },
  win: {
    target: ["nsis"],
    icon: resolve(repositoryRoot, "assets", "branding", "viniper-harness-circuit-node.ico"),
    signAndEditExecutable: true,
  },
  nsis: {
    include: join(desktopRoot, "build", "installer.nsh"),
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    runAfterFinish: false,
    artifactName: "Viniper-workstation-Preview-Setup.${ext}",
  },
};
await writeFile(builderConfigPath, `${JSON.stringify(builderConfig, null, 2)}\n`, "utf8");
// Node cannot execute a .cmd shim directly on Windows (EINVAL). Invoke the
// repository-local shim through cmd.exe with each argument kept as a distinct
// argv entry so paths containing spaces are preserved.
const builder = spawnSync(process.env.ComSpec || "cmd.exe", [
  "/d", "/c", "call", electronBuilder,
  "--prepackaged", stagePortable,
  "--win", "nsis", "--x64", "--publish", "never",
  "--config", builderConfigPath,
], {
  cwd: desktopRoot,
  encoding: "utf8",
  windowsHide: true,
  timeout: builderTimeoutMs,
});
if (builder.stdout) process.stdout.write(builder.stdout);
if (builder.stderr) process.stderr.write(builder.stderr);
if (builder.error?.code === "ETIMEDOUT") {
  throw new Error(`electron-builder NSIS 创建超时（${builderTimeoutMs}ms）。`);
}
if (builder.status !== 0) {
  throw new Error(`electron-builder NSIS 创建失败：${builder.stderr || builder.stdout || "无详情"}`);
}
const installerNames = (await readdir(builderRoot)).filter((name) => /Setup\.exe$/iu.test(name));
if (installerNames.length !== 1) {
  throw new Error(`electron-builder 应只生成一个 Setup：${JSON.stringify(installerNames)}`);
}
await cp(join(builderRoot, installerNames[0]), installerPath);
const installerStat = await stat(installerPath);
if (installerStat.size <= 0) throw new Error("NSIS Setup 为空。");

await cp(join(repositoryRoot, "scripts", "uninstall-preview.ps1"), join(outputRoot, "uninstall-preview.ps1"));
await writeFile(join(outputRoot, "install-metadata.json"), `${JSON.stringify({
  product: "Viniper workstation",
  version: sourcePackage.version,
  stage: "Preview（预览版）",
  installerKind: "electron-builder-nsis",
  portableDirectory: portableFolderName,
  portableZip: `${portableFolderName}.zip`,
  installer: "Viniper-workstation-Preview-Setup.exe",
  defaultInstallDirectory: "%LOCALAPPDATA%\\Programs\\Viniper workstation Preview",
  desktopShortcut: "Viniper workstation.lnk",
  userDataPolicy: "程序文件与用户数据根分离；重装/移除程序不删除用户数据。",
  uninstallScript: "uninstall-preview.ps1",
  nativeSetup: true,
  publicRelease: false,
}, null, 2)}\n`, "utf8");

await safeReset(stageRoot, residueRoot);
await safeReset(builderRoot, residueRoot);
await safeRemoveFile(builderConfigPath, residueRoot);
process.stdout.write(`${JSON.stringify({
  status: "WINDOWS_PREVIEW_PACKAGE_READY",
  installerKind: "electron-builder-nsis",
  executable: join(finalPortable, "Viniper workstation.exe"),
  portable: finalPortable,
  archive: zipPath,
  installer: installerPath,
})}\n`);

async function createZip(target, cwd, folder) {
  const archive = spawnSync("tar.exe", ["-a", "-c", "-f", target, "-C", cwd, folder], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (archive.status !== 0) {
    throw new Error(`Windows portable 压缩包创建失败：${archive.stderr || archive.stdout || "tar.exe 未提供详情"}`);
  }
}

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

async function brandWindowsExecutable(executable, version) {
  const { NtExecutable, NtExecutableResource, Resource, Data } = createRequire(join(desktopRoot, "package.json"))("resedit");
  const image = NtExecutable.from(await readFile(executable));
  const resources = NtExecutableResource.from(image);
  const icons = Data.IconFile.from(await readFile(join(repositoryRoot, "assets", "branding", "viniper-harness-circuit-node.ico")));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  if (!groups.length || !versions.length) throw new Error("Windows executable branding requires native icon and version resources.");
  for (const group of groups) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons.icons.map((item) => item.data));
  }
  for (const info of versions) {
    info.setFileVersion(version);
    info.setProductVersion(version);
    for (const language of info.getAvailableLanguages()) {
      info.setStringValues(language, {
        FileDescription: "Viniper workstation", ProductName: "Viniper workstation",
        CompanyName: "Viniper", InternalName: "Viniper workstation", OriginalFilename: "Viniper workstation.exe",
      });
    }
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(image);
  await writeFile(executable, Buffer.from(image.generate()));
}
