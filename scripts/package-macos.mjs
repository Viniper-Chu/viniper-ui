import { spawnSync } from "node:child_process";
import { access, chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { stageLegacyUi } from "./stage-legacy-ui.mjs";
import { designatedRequirement, loadMacSigningConfiguration, signMacApplication, verifyMacSignature } from "./lib/macos-signing.mjs";
import { prepareMacCredentialHelper } from "./lib/macos-keychain-helper.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { MAC_PYTHON_MINIMUM } = createRequire(import.meta.url)("../resources/viniper-ui/desktop/platform-runtime.js");
const product = "Viniper";
const appId = "com.viniper.workstation";
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("macOS 打包目前需要 Apple Silicon Mac。");
const localRepair = process.argv.includes("--local-repair-adhoc");
const signingConfiguration = localRepair ? null : await loadMacSigningConfiguration();
const metadata = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = join(repositoryRoot, "codex", "工作输出", "macos-package");
const output = join(outputRoot, `${metadata.version}-${stamp}`);
const residue = join(repositoryRoot, "codex", "运行残留", "macos-package", stamp);
const appPath = join(output, `${product}.app`);
const contents = join(appPath, "Contents");
const resources = join(contents, "Resources");
const electronApp = join(repositoryRoot, "node_modules", "electron", "dist", "Electron.app");
await access(join(electronApp, "Contents", "MacOS", "Electron"));
await access(join(repositoryRoot, "dist", "src", "platform", "desktop", "main.js"));
await mkdir(output, { recursive: true });
await mkdir(residue, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8", timeout: 300000, ...options });
  if (result.status !== 0) throw new Error(`${command} 失败：${result.stderr || result.stdout || result.error?.message || result.status}`);
  return result.stdout.trim();
}

run("/usr/bin/ditto", [electronApp, appPath]);
await rename(join(contents, "MacOS", "Electron"), join(contents, "MacOS", product));
const staged = await stageLegacyUi({ repositoryRoot, stagePortable: residue, desktopProfile: "stable" });
await cp(join(residue, "resources"), resources, { recursive: true });
await cp(join(repositoryRoot, "resources", "viniper-ui", "desktop", "platform-runtime.js"), join(resources, "app", "platform-runtime.js"));
await writeFile(join(resources, "app", "package.json"), `${JSON.stringify({
  name: "viniper-workstation", version: metadata.version, private: true,
  main: "main.js", viniperProfile: "stable", releaseStage: "Local macOS",
}, null, 2)}\n`);
await rm(join(resources, "default_app.asar"), { force: true });
await mkdir(join(resources, "runtime", "bin"), { recursive: true });
await cp(process.execPath, join(resources, "runtime", "bin", "node"));
await chmod(join(resources, "runtime", "bin", "node"), 0o755);
const credentialHelper = signingConfiguration ? await prepareMacCredentialHelper(repositoryRoot, signingConfiguration) : null;
const credentialHelperPath = join(resources, "runtime", "bin", "viniper-keychain");
if (credentialHelper) await cp(credentialHelper.binary, credentialHelperPath);
const linkedLibraries = run("/usr/bin/otool", ["-L", join(resources, "runtime", "bin", "node")]);
if (linkedLibraries.split("\n").slice(1).some((line) => {
  const library = line.trim().split(" ")[0];
  return library && !library.startsWith("/System/Library/") && !library.startsWith("/usr/lib/");
})) throw new Error("Node 依赖非系统动态库，不能仅复制该 Node 二进制。请使用官方独立版 Node。");
run(join(resources, "runtime", "bin", "node"), ["--version"]);

const iconset = join(residue, "Viniper.iconset");
await mkdir(iconset, { recursive: true });
const icon = join(repositoryRoot, "resources", "viniper-ui", "static", "assets", "viniper-harness-circuit-node.png");
const iconLayout = run("/usr/bin/swift", [join(repositoryRoot, "scripts", "build-macos-icon.swift"), icon, iconset]);
await writeFile(join(residue, "macos-icon-layout.json"), `${iconLayout}\n`);
run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", join(resources, "Viniper.icns")]);
// Finder consumes ICNS; Electron's nativeImage/Dock API requires a PNG.
// Both representations must retain the same transparent outer margin.
await cp(join(iconset, "icon_512x512@2x.png"), join(resources, "Viniper-dock.png"));
const plist = join(contents, "Info.plist");
for (const [key, value] of Object.entries({
  CFBundleIdentifier: appId, CFBundleName: product, CFBundleDisplayName: product,
  CFBundleExecutable: product, CFBundleShortVersionString: metadata.version,
  CFBundleVersion: metadata.version, CFBundleIconFile: "Viniper.icns",
  NSHumanReadableCopyright: "Viniper", LSApplicationCategoryType: "public.app-category.productivity",
})) {
  const existing = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8" });
  run("/usr/libexec/PlistBuddy", ["-c", `${existing.status === 0 ? "Set" : "Add"} :${key}${existing.status === 0 ? "" : " string"} ${value}`, plist]);
}

const runtimePolicy = {
  node: { kind: "bundled", version: process.version, architecture: process.arch },
  python: { kind: "host-python-dedicated-venv", minimum: MAC_PYTHON_MINIMUM, stableOnly: true, verifiedLatestStable: "3.15.0", verifiedAt: "2026-10-15", relativeToUserData: "runtime/python/bin/python3", installCommand: "npm run install:macos" },
  dataDirectory: "~/Library/Application Support/Viniper workstation",
  signing: localRepair ? "local-repair-adhoc" : "local-certificate",
  credentialStorage: credentialHelper ? { kind: "stable-keychain-helper", protocol: 1 } : { kind: "electron-safe-storage" },
  ...(signingConfiguration ? { signingIdentity: signingConfiguration.identity } : {
    signingLimitation: "Local startup repair only; cloud Keychain authorization continuity is not verified.",
  }), notarized: false,
};
await writeFile(join(resources, "runtime", "manifest.json"), `${JSON.stringify(runtimePolicy, null, 2)}\n`);
await access(join(resources, "viniper-ui", "model_catalog.py"));
await access(join(resources, "viniper-ui", "harness-runtime", "dist", "src", "platform", "bootstrap", "create-harness-application.js"));
if (localRepair) {
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
}
const signingRequirement = localRepair ? designatedRequirement(appPath) : signMacApplication(appPath, signingConfiguration,
  new Map(credentialHelper ? [[credentialHelperPath, credentialHelper.requirement]] : []));
if (credentialHelper) verifyMacSignature(credentialHelperPath,
  signingRequirement.replace('identifier "com.viniper.workstation"', 'identifier "com.viniper.workstation.credentials"'));
const zipPath = process.argv.includes("--no-archive") ? null : join(output, `Viniper-${metadata.version}-mac-arm64.zip`);
if (zipPath) run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
const result = {
  status: "MACOS_LOCAL_PACKAGE_READY", product, appId, version: metadata.version,
  platform: "darwin", architecture: "arm64", appPath, zipPath, ...runtimePolicy,
  signingRequirement,
  runtimeSource: staged.runtimeRoot,
};
await writeFile(join(output, "install-metadata.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(join(outputRoot, "latest-macos-package.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
