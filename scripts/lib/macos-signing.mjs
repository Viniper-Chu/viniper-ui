import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { closeSync, openSync, readSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export const localSigningConfiguration = join(homedir(), "Library", "Application Support", "Viniper workstation", "signing", "local-signing.json");

export async function loadMacSigningConfiguration(environment = process.env, file = localSigningConfiguration) {
  let saved = {};
  try { saved = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const identity = String(environment.VINIPER_MACOS_SIGNING_IDENTITY || saved.identity || "").trim();
  if (!identity || identity === "-") throw new Error("Mac 正式安装需要固定签名身份。请先运行 npm run setup:macos-signing；不能继续用临时签名反复请求钥匙串授权。");
  return { identity, keychain: String(environment.VINIPER_MACOS_SIGNING_KEYCHAIN || saved.keychain || "").trim() };
}

function codesign(args) {
  const result = spawnSync("/usr/bin/codesign", args, { encoding: "utf8", timeout: 300000 });
  if (result.status !== 0) {
    const cause = result.error?.code || result.signal || `exit ${result.status}`;
    throw new Error(`Mac 签名验证失败（${cause}）：${result.stderr || result.error?.message || "命令未成功完成"}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function designatedRequirement(appPath) {
  const output = codesign(["-d", "-r-", appPath]);
  return parseDesignatedRequirement(output);
}

export function parseDesignatedRequirement(output) {
  // codesign prefixes an inferred requirement (including old ad-hoc builds)
  // with '# '. It is still the requirement used to identify that build.
  const requirement = output.match(/^(?:#\s*)?designated => (.+)$/mu)?.[1];
  if (!requirement) throw new Error("无法读取应用的系统签名身份。");
  return requirement;
}

export function isStableRequirement(requirement) {
  return /\bidentifier\s/u.test(requirement) && /\b(?:certificate|anchor)\s/u.test(requirement) && !/\bcdhash\b/u.test(requirement);
}

export function verifyMacSignature(appPath, requirement) {
  codesign(["--verify", "--deep", "--strict", ...(requirement ? [`-R=${requirement}`] : []), appPath]);
}

export function macSigningTargets(appPath) {
  const targets = [];
  const magic = Buffer.alloc(4);
  const machO = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      // Framework aliases point to files already visited under Versions.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const file = openSync(path, "r");
        try { if (readSync(file, magic, 0, 4, 0) === 4 && machO.has(magic.readUInt32BE())) targets.push(path); }
        finally { closeSync(file); }
      }
    }
    if (directory === appPath || /\.(?:app|framework|xpc|bundle)$/u.test(directory)) targets.push(directory);
  }
  visit(appPath);
  return targets;
}

export function signMacApplication(appPath, configuration, preservedCode = new Map()) {
  // Apple TN2206: sign nested code inside out, individually. --deep belongs
  // to verification; using it to sign can queue concurrent private-key IPCs.
  const targets = macSigningTargets(appPath);
  for (const [index, target] of targets.entries()) {
    process.stdout.write(`[macOS signing ${index + 1}/${targets.length}] ${relative(appPath, target) || "application"}\n`);
    if (preservedCode.has(target)) {
      verifyMacSignature(target, preservedCode.get(target));
      continue;
    }
    codesign(["--force", "--sign", configuration.identity,
      ...(configuration.keychain ? ["--keychain", configuration.keychain] : []), "--timestamp=none", target]);
  }
  verifyMacSignature(appPath);
  const requirement = designatedRequirement(appPath);
  if (!isStableRequirement(requirement)) throw new Error("签名仍绑定单个构建，不能用于保持钥匙串授权。");
  return requirement;
}
