// Create one local signing identity. The private key is imported into the
// user's login Keychain, restricted to codesign, and never kept in the repo.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { localSigningConfiguration } from "./lib/macos-signing.mjs";

if (process.platform !== "darwin") throw new Error("此设置仅适用于 macOS。");
const signingRoot = dirname(localSigningConfiguration);
await mkdir(signingRoot, { recursive: true, mode: 0o700 });
try {
  const existing = JSON.parse(await readFile(localSigningConfiguration, "utf8"));
  if (existing.identity) {
    process.stdout.write("已找到固定签名身份，保留现有身份；实际可用性由打包签名和凭据连续性验证确认。\n");
    process.exit(0);
  }
} catch (error) { if (error.code !== "ENOENT") throw error; }

const identity = "Viniper Workstation Local Signing";
const password = randomBytes(32).toString("base64");
const environment = { ...process.env, VINIPER_SIGNING_TRANSIENT_PASSPHRASE: password };
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: environment, timeout: 30000, ...options });
  if (result.status !== 0) throw new Error(`签名身份设置失败：${result.stderr || result.error?.message || result.status}`);
  return result.stdout.trim();
}
const keychain = run("/usr/bin/security", ["default-keychain", "-d", "user"]).trim().replace(/^"|"$/gu, "");
// Reuse an already-created identity after an interrupted setup instead of
// generating a second certificate with the same name.
const existingCertificate = spawnSync("/usr/bin/security", ["find-certificate", "-c", identity, "-p", keychain], { encoding: "utf8", timeout: 10000 });
if (existingCertificate.status !== 0) {
  const temporary = await mkdtemp(join(signingRoot, "setup-"));
  try {
    const config = join(temporary, "certificate.cnf");
    const key = join(temporary, "signing-key.enc.pem");
    const certificate = join(temporary, "signing-certificate.pem");
    const archive = join(temporary, "signing-identity.p12");
    await writeFile(config, `[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=codesign\n[subject]\nCN=${identity}\n[codesign]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=critical,codeSigning\n`, { mode: 0o600 });
    run("/usr/bin/openssl", ["req", "-new", "-x509", "-newkey", "rsa:2048", "-days", "3650", "-config", config,
      "-keyout", key, "-out", certificate, "-passout", "env:VINIPER_SIGNING_TRANSIENT_PASSPHRASE"]);
    run("/usr/bin/openssl", ["pkcs12", "-export", "-inkey", key, "-in", certificate, "-out", archive,
      "-passin", "env:VINIPER_SIGNING_TRANSIENT_PASSPHRASE", "-passout", "env:VINIPER_SIGNING_TRANSIENT_PASSPHRASE"]);
    // This is an ephemeral archive passphrase, never the user's login password.
    // Only this new signing key grants codesign access; no existing item or
    // global Keychain/trust policy is changed.
    run("/usr/bin/security", ["import", archive, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"]);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
await writeFile(localSigningConfiguration, `${JSON.stringify({ identity, keychain, purpose: "local-application-signing", publicDistribution: false }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write("本机固定签名身份已保存到登录钥匙串；私钥访问尚未验收。首次正常签名及跨构建钥匙串检查通过后，才可确认更新授权连续性。未修改系统信任或已有凭证权限。\n");
