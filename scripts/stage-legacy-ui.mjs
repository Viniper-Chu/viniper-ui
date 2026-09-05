import { access, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LEGACY_RUNTIME_FILES = [
  "agent_host_bridge.py",
  "agent_instructions.py",
  "agent_queue.py",
  "agent_run_coordinator.py",
  "agent_runtime.py",
  "context_lifecycle.py",
  "context_usage.py",
  "model-capabilities.json",
  "daily_usage.py",
  "harness_application_port.py",
  "harness_provider_boundary.js",
  "harness_runtime_bridge.js",
  "harness_usage_projection.js",
  "native_peer.py",
  "native_commands.py",
  "native_stream_protocol.py",
  "native_project_browser.py",
  "profiles.json",
  "requirements.txt",
  "server.py",
  "skill_sync.py",
  "skills-lock.json",
  "update_source.json",
  "update_manager.py",
  "VERSION",
  "RELEASE_REVISION",
  "wsl_runtime.py",
];

const LEGACY_RUNTIME_DIRS = ["static", "harness-runtime"];
const DESKTOP_FILES = ["main.js", "preload.js", "profile-owner.js"];

/**
 * Stage the verified Aug-24 static renderer and its HTTP/Application Port
 * runtime without copying the previous desktop installation or dependency
 * caches. The current TypeScript build is overlaid into harness-runtime so
 * the restored UI keeps the R18 tool-loop and persistence repairs.
 */
export async function stageLegacyUi({ repositoryRoot, stagePortable, desktopProfile = "preview" }) {
  const sourceRoot = join(repositoryRoot, "resources", "viniper-ui");
  await access(join(sourceRoot, "static", "index.html"));
  await access(join(sourceRoot, "server.py"));
  await access(join(repositoryRoot, "dist", "src"));

  const appRoot = join(stagePortable, "resources", "app");
  const runtimeRoot = join(stagePortable, "resources", "viniper-ui");
  await mkdir(appRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });

  for (const directory of LEGACY_RUNTIME_DIRS) {
    await cp(join(sourceRoot, directory), join(runtimeRoot, directory), { recursive: true, force: true });
  }
  for (const file of LEGACY_RUNTIME_FILES) {
    await cp(join(sourceRoot, file), join(runtimeRoot, file), { force: true });
  }
  for (const file of DESKTOP_FILES) {
    await cp(join(sourceRoot, "desktop", file), join(appRoot, file), { force: true });
  }

  // The packaged desktop shell uses this explicit profile marker instead of
  // inferring a release lane from the executable name.  Preview and Stable
  // therefore remain independently identifiable while sharing the same
  // Workstation-compatible data root.
  const packagePath = join(appRoot, "package.json");
  let packageJson = {};
  try {
    packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  } catch {
    packageJson = {};
  }
  await writeFile(
    packagePath,
    `${JSON.stringify({ ...packageJson, viniperProfile: desktopProfile }, null, 2)}\n`,
    "utf8",
  );

  // Copy the contents of the current compiled runtime into the existing
  // runtime directory. Copying entries keeps the runtime tree flat.
  const compiledRuntime = join(repositoryRoot, "dist", "src");
  const runtimeDist = join(runtimeRoot, "harness-runtime", "dist", "src");
  await mkdir(runtimeDist, { recursive: true });
  for (const entry of await readdir(compiledRuntime, { withFileTypes: true })) {
    await cp(join(compiledRuntime, entry.name), join(runtimeDist, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    });
  }

  // The restored desktop shell resolves its vendor TypeScript from the
  // harness-runtime root, which is intentionally included in the verified
  // static bundle.
  await access(join(runtimeRoot, "harness-runtime", "vendor", "typescript.js"));

  return {
    runtimeRoot,
    staticIndex: join(runtimeRoot, "static", "index.html"),
    desktopMain: join(appRoot, "main.js"),
    harnessDist: runtimeDist,
    vendorTypeScript: join(runtimeRoot, "harness-runtime", "vendor", "typescript.js"),
  };
}

export async function readLegacyDesktopPackage(repositoryRoot) {
  return JSON.parse(await readFile(
    join(repositoryRoot, "resources", "viniper-ui", "desktop", "package.json"),
    "utf8",
  ));
}
