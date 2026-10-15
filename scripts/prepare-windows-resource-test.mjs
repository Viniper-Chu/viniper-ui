import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Test-only preparation: no Windows executable is launched or installed. The
// Mac application has no dependency on these tools or downloaded resources.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repositoryRoot, "codex", "运行残留", "windows-resource-fixture");
await mkdir(fixtureRoot, { recursive: true });
const pkg = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const version = pkg.devDependencies.electron;
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("The Electron fixture requires an exact release version");
const name = `electron-v${version}-win32-x64.zip`;
const url = `https://github.com/electron/electron/releases/download/v${version}/${name}`;
const archive = join(fixtureRoot, name);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (!existsSync(archive)) run("curl", ["--fail", "--location", "--retry", "2", "--connect-timeout", "30", "--silent", "--show-error", "--output", archive, url]);
run("unzip", ["-o", "-j", archive, "electron.exe", "-d", fixtureRoot]);
run("npm", ["install", "--prefix", fixtureRoot, "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "resedit@1.7.2"]);
await writeFile(join(fixtureRoot, "fixture-origin.json"), `${JSON.stringify({
  source: url, electronVersion: version, targetPlatform: "win32", targetArchitecture: "x64",
  purpose: "Inspect and edit real Windows PE version/icon resources without executing the EXE", preparedOn: process.platform,
}, null, 2)}\n`);
console.log(`Windows PE resource fixture prepared: ${join(fixtureRoot, "electron.exe")}`);
