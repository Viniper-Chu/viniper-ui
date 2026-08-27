import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PRODUCT_BADGE, PRODUCT_NAME } from "../../core/contracts";
import { createHarnessApplication } from "../bootstrap/create-harness-application";
import { acquireDataRootLease, DataRootLease } from "../persistence/data-root-lease";
import { UnavailableSecretVault } from "../security/unavailable-secret-vault";
import { createRuntimeClient, RuntimeApplicationClient, RuntimeOwner, startRuntimeOwner } from "../runtime-host/local-runtime-host";
import { DesktopApplication } from "../desktop/desktop-application";
import { createCliApplicationPort } from "./application-port";
import { CLI_EVENT_SCHEMA_VERSION, CLI_EXIT_CODE, CliOutputMode, CliPresenter } from "./contracts";
import { CliController } from "./controller";
import { parseCliInvocation } from "./parser";
import { ChineseTtyPresenter, JsonlPresenter } from "./presenters";

export interface CliHostArguments {
  dataRoot: string;
  projectRoot: string;
  invocationArguments: string[];
  output: CliOutputMode;
}

export type CliHostArgumentResult =
  | { ok: true; value: CliHostArguments }
  | { ok: false; message: string; output: CliOutputMode };

export function parseCliHostArguments(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): CliHostArgumentResult {
  const invocationArguments: string[] = [];
  let dataRoot: string | undefined;
  let projectRoot: string | undefined;
  const npmOutputArgument = npmForwardedOutputArgument(environment);
  const output: CliOutputMode = argv.some((argument) => argument === "--json" || argument === "--jsonl")
    ? "jsonl"
    : argv.includes("--plain") ? "plain"
      : npmOutputArgument === "--jsonl" ? "jsonl"
        : npmOutputArgument === "--plain" ? "plain" : "tty";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--data-root") {
      if (dataRoot !== undefined) return { ok: false, message: "--data-root 不能重复指定。", output };
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, message: "--data-root 后必须提供目录。", output };
      }
      dataRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--data-root=")) {
      if (dataRoot !== undefined) return { ok: false, message: "--data-root 不能重复指定。", output };
      const value = argument.slice("--data-root=".length).trim();
      if (!value) return { ok: false, message: "--data-root 后必须提供目录。", output };
      dataRoot = resolve(value);
      continue;
    }
    if (argument === "--project") {
      if (projectRoot !== undefined) return { ok: false, message: "--project 不能重复指定。", output };
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, message: "--project 后必须提供目录。", output };
      }
      projectRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--project=")) {
      if (projectRoot !== undefined) return { ok: false, message: "--project 不能重复指定。", output };
      const value = argument.slice("--project=".length).trim();
      if (!value) return { ok: false, message: "--project 后必须提供目录。", output };
      projectRoot = resolve(value);
      continue;
    }
    invocationArguments.push(argument);
  }
  if (npmOutputArgument && !invocationArguments.some((argument) =>
    argument === "--json" || argument === "--jsonl" || argument === "--plain")) {
    invocationArguments.push(npmOutputArgument);
  }
  return {
    ok: true,
    value: {
      dataRoot: dataRoot ?? defaultCliDataRoot(),
      projectRoot: projectRoot ?? process.cwd(),
      invocationArguments,
      output,
    },
  };
}

function npmForwardedOutputArgument(environment: NodeJS.ProcessEnv): "--jsonl" | "--plain" | undefined {
  if (npmFlag(environment.npm_config_jsonl) || npmFlag(environment.npm_config_json)) return "--jsonl";
  return npmFlag(environment.npm_config_plain) ? "--plain" : undefined;
}

function npmFlag(value: string | undefined): boolean {
  return value !== undefined && value !== "false" && value !== "0";
}

export function defaultCliDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = environment.AGENT_CLI_PREVIEW_DATA_ROOT?.trim()
    || environment.npm_config_data_root?.trim();
  if (override) return resolve(override);
  if (platform === "win32") {
    const localData = environment.LOCALAPPDATA ?? environment.APPDATA ?? join(homedir(), "AppData", "Local");
    // Compatibility alias: do not migrate or silently hide existing CLI Preview sessions.
    return join(localData, "Viniper workstation CLI", "Preview-0.1.0");
  }
  const localData = environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(localData, "viniper-workstation-cli", "Preview-0.1.0");
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const hostArguments = parseCliHostArguments(argv);
  if (!hostArguments.ok) {
    hostPresenter(hostArguments.output).present(errorEvent(hostArguments.message));
    return CLI_EXIT_CODE.usageError;
  }
  const invocation = parseCliInvocation(hostArguments.value.invocationArguments);
  const output = invocation.ok ? invocation.value.output : (invocation.output ?? hostArguments.value.output);
  const presenter = hostPresenter(output);
  if (!invocation.ok) {
    presenter.present(errorEvent(invocation.message));
    return CLI_EXIT_CODE.usageError;
  }

  let lease: DataRootLease | undefined;
  let application: DesktopApplication | RuntimeApplicationClient | undefined;
  let runtimeOwner: RuntimeOwner | undefined;
  let controller: CliController | undefined;
  try {
    try {
      application = await createRuntimeClient(hostArguments.value.dataRoot);
    } catch {
      lease = await acquireDataRootLease(hostArguments.value.dataRoot, `${PRODUCT_NAME} CLI`);
      const bundle = await createHarnessApplication({
        dataRoot: hostArguments.value.dataRoot,
        workingDirectory: hostArguments.value.projectRoot,
        assetsRoot: resolve(__dirname, "../../../.."),
        secretVault: new UnavailableSecretVault(),
        approvalHostMode: "fail-closed",
        defaultProjectAccess: { enabled: true, selectedBy: "cli-explicit" },
      });
      runtimeOwner = await startRuntimeOwner({
        dataRoot: hostArguments.value.dataRoot,
        service: bundle.application,
        ownerId: `${PRODUCT_NAME} CLI`,
        lease,
      });
      lease = undefined;
      application = bundle.application;
    }
    const port = createCliApplicationPort(application);
    await port.openProjectSession(hostArguments.value.projectRoot);
    controller = new CliController(port, presenter);
    const outcome = await controller.executeInvocation(invocation.value);
    if (invocation.value.kind !== "interactive") return outcome.exitCode ?? CLI_EXIT_CODE.completed;
    return await runInteractive(controller);
  } catch (error) {
    presenter.present(errorEvent(error instanceof Error ? error.message : String(error), "CLI_START_FAILED"));
    return CLI_EXIT_CODE.runFailed;
  } finally {
    controller?.dispose();
    await runtimeOwner?.dispose();
    await application?.dispose();
    await lease?.release();
  }
}

function runInteractive(controller: CliController): Promise<number> {
  const terminal = process.stdout.isTTY === true;
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal });
  input.setPrompt("agent> ");
  let queue = Promise.resolve();
  let requestedExitCode = CLI_EXIT_CODE.completed as number;

  return new Promise((resolveExit) => {
    const prompt = () => { if (terminal) input.prompt(); };
    input.on("line", (line) => {
      queue = queue.then(async () => {
        const outcome = await controller.executeLine(line);
        if (outcome.exitRequested) {
          requestedExitCode = outcome.exitCode ?? CLI_EXIT_CODE.completed;
          input.close();
        } else {
          prompt();
        }
      });
    });
    input.on("SIGINT", () => {
      queue = queue.then(async () => {
        const outcome = await controller.handleInterrupt();
        if (outcome.exitRequested) {
          requestedExitCode = outcome.exitCode ?? CLI_EXIT_CODE.cancelled;
          input.close();
        } else {
          prompt();
        }
      });
    });
    input.on("close", () => {
      void queue.finally(() => resolveExit(requestedExitCode));
    });
    prompt();
  });
}

function hostPresenter(output: CliOutputMode): CliPresenter {
  return output === "jsonl"
    ? new JsonlPresenter(process.stdout)
    : new ChineseTtyPresenter(process.stdout, { color: output === "tty" && process.stdout.isTTY === true });
}

function errorEvent(message: string, code = "CLI_USAGE") {
  return {
    schemaVersion: CLI_EVENT_SCHEMA_VERSION,
    type: "error" as const,
    timestamp: Date.now(),
    data: { code, message, productBadge: PRODUCT_BADGE },
  };
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
