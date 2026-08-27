import { CompositionPreset } from "../../core/composition-contracts";
import { CliCommand, CliInvocation, CliParseResult } from "./contracts";

export const CLI_HELP_COMMANDS = [
  { syntax: "/help", description: "查看命令帮助" },
  { syntax: "/new [名称]", description: "新建并切换到独立会话" },
  { syntax: "/sessions [搜索词]", description: "列出全部会话或按标题、项目、Provider 搜索" },
  { syntax: "/session-delete <会话ID>", description: "明确删除一个会话；不会删除项目文件" },
  { syntax: "/routing", description: "查看智能模型分配状态与最近一次选择" },
  { syntax: "/capabilities", description: "查看当前能力方案、用途、模型建议、阻塞与冻结边界" },
  { syntax: "/preset [standard|deepseek-efficient|minimal|custom <名称>]", description: "选择能力方案；只影响下一次 run" },
  { syntax: "/preset-copy <来源> <名称>", description: "复制内置能力方案为自定义方案" },
  { syntax: "/preset-toggle <名称> <能力ID> <on|off>", description: "启停自定义方案中的单项能力" },
  { syntax: "/preset-order <名称> <能力ID,能力ID,...>", description: "保存自定义方案的有意义执行顺序" },
  { syntax: "/preset-restore", description: "恢复默认能力方案" },
  { syntax: "/steer <运行ID> <消息>", description: "向活动 run 投递下一步指令" },
  { syntax: "/workflow [工作流ID] [JSON输入]", description: "查看或通过同一 Runtime 运行工作流" },
  { syntax: "/workflow-cancel <运行ID>", description: "取消指定工作流运行" },
  { syntax: "/workflow-recover <运行ID> reconfirm", description: "重新授权后恢复未知工作流步骤" },
  { syntax: "/memory", description: "查看当前正式应用端口中的记忆条目" },
  { syntax: "/memory-create <scope> <正文>", description: "创建 session-auto/project/personal 记忆" },
  { syntax: "/memory-update <ID> <正文>", description: "编辑记忆正文" },
  { syntax: "/memory-enable <ID> <on|off>", description: "启用或停用记忆" },
  { syntax: "/memory-delete <ID>", description: "明确删除记忆" },
  { syntax: "/index [build|search <词>|semantic <on|off>]", description: "查看或管理当前明确项目索引" },
  { syntax: "/runs", description: "列出当前会话的运行栈" },
  { syntax: "/run-select <运行ID>", description: "选择一个运行" },
  { syntax: "/run-cancel <运行ID>", description: "只取消指定运行" },
  { syntax: "/use <会话>", description: "按 ID、唯一前缀或名称切换会话" },
  { syntax: "/rename <名称>", description: "重命名当前空闲会话" },
  { syntax: "/run <任务>", description: "在当前会话执行 Agent 任务；普通文本等价" },
  { syntax: "/cancel", description: "只取消当前会话的运行或等待" },
  { syntax: "/tokens", description: "分别显示实时估算与 Provider 最终 usage" },
  { syntax: "/inbox", description: "查看当前会话收件箱" },
  { syntax: "/send <目标> <消息>", description: "向另一个会话发消息" },
  { syntax: "/delegate <目标> <任务>", description: "委派任务给另一个会话" },
  { syntax: "/wait [来源]", description: "等待任意或指定会话的消息" },
  { syntax: "/schedules", description: "只读列出自动任务" },
  { syntax: "/schedule-create <JSON>", description: "创建本地自动任务" },
  { syntax: "/schedule-enable <ID> <on|off>", description: "暂停或恢复自动任务" },
  { syntax: "/schedule-run <ID>", description: "立即运行一个自动任务" },
  { syntax: "/schedule-delete <ID>", description: "删除自动任务定义" },
  { syntax: "/schedule-restore <ID>", description: "恢复已删除自动任务" },
  { syntax: "/notifications", description: "查看同一应用端口的通知状态" },
  { syntax: "/artifacts", description: "查看当前应用端口登记的受管产物引用" },
  { syntax: "/artifact-read <产物ID> <运行ID> [偏移] [字节数]", description: "按受管范围续读产物；跨 run 会拒绝" },
  { syntax: "/skills", description: "只读列出 Skills" },
  { syntax: "/extensions", description: "只读列出扩展来源、版本、信任、能力与回退状态" },
  { syntax: "/extension-stage <路径> [来源]", description: "受管暂存扩展清单，不执行代码" },
  { syntax: "/extension-install <暂存ID>", description: "安装受管扩展" },
  { syntax: "/extension-trust <ID> <版本>", description: "显式信任扩展版本" },
  { syntax: "/extension-enable <ID> <on|off>", description: "启用或停用已信任扩展" },
  { syntax: "/extension-update <ID> <暂存ID>", description: "请求扩展更新" },
  { syntax: "/extension-update-confirm <ID>", description: "确认扩展更新" },
  { syntax: "/extension-rollback <ID>", description: "请求回退扩展" },
  { syntax: "/extension-rollback-confirm <ID>", description: "确认扩展回退" },
  { syntax: "/mcp-config <ID> <loopback端点>", description: "配置用户明确指定的 MCP" },
  { syntax: "/mcp-connect <ID>", description: "连接已配置的本地 MCP" },
  { syntax: "/providers", description: "只读列出 Provider 与模型状态" },
  { syntax: "/provider <profile> <model>", description: "选择已配置的 Provider/model" },
  { syntax: "/provider-endpoint <profile> <端点>", description: "设置 Provider endpoint（仅本地/配置边界）" },
  { syntax: "/provider-manual-model <profile> <model>", description: "设置 Provider 手工模型" },
  { syntax: "/provider-capabilities <profile> <tools,...>", description: "声明 profile 能力开关" },
  { syntax: "/local-models", description: "查看本地模型来源、版本和工具能力" },
  { syntax: "/local-model-register <JSON>", description: "登记已有本地 loopback/runner，不下载权重" },
  { syntax: "/local-model-confirm <ID> <版本>", description: "确认采用本地模型版本" },
  { syntax: "/local-model-update <ID> <版本>", description: "请求本地模型更新" },
  { syntax: "/local-model-update-confirm <ID>", description: "确认本地模型更新" },
  { syntax: "/permission <级别>", description: "ask（手动审核）/ auto（自动审核）/ full（完全访问）" },
  { syntax: "/restore <回执>", description: "按可恢复删除回执恢复当前项目路径" },
  { syntax: "/terminal-output <执行ID> <stdout|stderr> [偏移] [字节数]", description: "续读当前会话的受管终端输出" },
  { syntax: "/workspace", description: "查看当前项目工作区模式、状态、检查与合并回执" },
  { syntax: "/review", description: "查看最近一次只读自动审查结果" },
  { syntax: "/settings", description: "查看同一 Runtime 的产品设置摘要" },
  { syntax: "/diagnostics [运行ID]", description: "预览最小诊断字段；不显示消息、命令或凭据正文" },
  { syntax: "/diagnostics-consent <on|off>", description: "设置匿名诊断同意；未配置官方源仍不可上传" },
  { syntax: "/updates [preview|stable]", description: "检查本地配置的更新源；未配置时安全不可用" },
  { syntax: "/update-download", description: "下载已发现的本地更新 fixture" },
  { syntax: "/update-install", description: "确认安装已准备更新" },
  { syntax: "/setting <键> <值>", description: "修改同一 Runtime 的产品设置" },
  { syntax: "/archive-export <路径>", description: "导出非秘密本地归档；产物使用相对受管引用" },
  { syntax: "/archive-import <路径>", description: "暂存并预览非秘密归档冲突，不自动合并" },
  { syntax: "/credential-export <路径>", description: "进入密钥包导出边界；密码不从命令参数读取" },
  { syntax: "/credential-import <路径>", description: "进入密钥包导入边界；密码不从命令参数读取" },
  { syntax: "/quit", description: "空闲时退出" },
] as const;

export function parseCliInvocation(argv: readonly string[]): CliParseResult<CliInvocation> {
  const outputArguments = argv.filter(isOutputArgument);
  const errorOutput = outputForArgument(outputArguments.at(-1));
  if (outputArguments.length > 1) {
    return failure(`${outputArguments[0]} 与 ${outputArguments[1]} 不能同时或重复指定。`, errorOutput);
  }
  const output = outputForArgument(outputArguments[0]);
  const commandArguments = argv.filter((argument) => !isOutputArgument(argument));
  if (commandArguments.length === 0) return success({ kind: "interactive", output });
  if (commandArguments.length === 1 && (commandArguments[0] === "--help" || commandArguments[0] === "-h")) {
    return success({ kind: "help", output });
  }
  if (commandArguments[0] !== "run") {
    return failure(`未知入口 '${commandArguments[0]}'。请使用 --help 或 run --prompt <任务> [--plain|--jsonl]。`, errorOutput);
  }
  let prompt: string | undefined;
  for (let index = 1; index < commandArguments.length; index += 1) {
    const argument = commandArguments[index];
    if (argument === "--help" || argument === "-h") {
      return success({ kind: "help", output });
    }
    if (argument === "--prompt") {
      if (prompt !== undefined) return failure("--prompt 不能重复指定。", errorOutput);
      const value = commandArguments[index + 1];
      if (value === undefined || value.startsWith("--")) return failure("--prompt 后必须提供任务内容。", errorOutput);
      prompt = value.trim();
      index += 1;
      continue;
    }
    if (argument.startsWith("--prompt=")) {
      if (prompt !== undefined) return failure("--prompt 不能重复指定。", errorOutput);
      prompt = argument.slice("--prompt=".length).trim();
      continue;
    }
    return failure(`未知参数 '${argument}'。`, errorOutput);
  }
  if (!prompt) return failure("非交互 run 必须提供非空 --prompt。 ", errorOutput);
  return success({ kind: "run", output, prompt });
}

function isOutputArgument(argument: string): boolean {
  return argument === "--json" || argument === "--jsonl" || argument === "--plain";
}

function outputForArgument(argument: string | undefined): CliInvocation["output"] {
  if (argument === "--json" || argument === "--jsonl") return "jsonl";
  return argument === "--plain" ? "plain" : "tty";
}

export function parseCliLine(input: string): CliParseResult<CliCommand> {
  const line = input.trim();
  if (!line) return success({ kind: "empty" });
  if (!line.startsWith("/")) return success({ kind: "run", prompt: line });

  const tokenResult = tokenize(line.slice(1));
  if (!tokenResult.ok) return tokenResult;
  const [rawName, ...args] = tokenResult.value;
  const name = rawName?.toLocaleLowerCase("en-US") ?? "";
  switch (name) {
    case "help": return noArguments(name, args, { kind: "help" });
    case "new": return success({ kind: "new", name: joined(args) || undefined });
    case "sessions": return parseSessions(args);
    case "session-delete": return args.length === 1
      ? success({ kind: "session-delete", sessionId: args[0] })
      : failure("/session-delete 需要一个会话 ID。");
    case "routing": return noArguments(name, args, { kind: "routing" });
    case "capabilities": return noArguments(name, args, { kind: "capabilities" });
    case "preset": return parsePreset(args);
    case "preset-copy": return parsePresetCopy(args);
    case "preset-toggle": return args.length === 3 && isOnOff(args[2])
      ? success({ kind: "preset-toggle", name: args[0], capabilityId: args[1], enabled: args[2] === "on" })
      : failure("/preset-toggle 需要自定义方案名、能力 ID 和 on|off。 ");
    case "preset-order": return args.length === 2 && args[1].split(",").every(Boolean)
      ? success({ kind: "preset-order", name: args[0], order: args[1].split(",") })
      : failure("/preset-order 需要自定义方案名和逗号分隔的能力 ID。 ");
    case "preset-restore": return noArguments(name, args, { kind: "preset-restore" });
    case "steer": return args.length >= 2
      ? success({ kind: "steer", runId: args[0], message: joined(args.slice(1)) })
      : failure("/steer 需要运行 ID 和消息。 ");
    case "workflow": return args.length === 0
      ? success({ kind: "workflow" })
      : args.length <= 2
        ? success({ kind: "workflow", workflowId: args[0], input: args[1] ?? "{}" })
        : failure("/workflow 最多接受工作流 ID 和一个 JSON 输入对象。 ");
    case "workflow-cancel": return args.length === 1
      ? success({ kind: "workflow-cancel", workflowRunId: args[0] })
      : failure("/workflow-cancel 需要工作流运行 ID。 ");
    case "workflow-recover": return args.length === 2 && args[1] === "reconfirm"
      ? success({ kind: "workflow-recover", workflowRunId: args[0], decision: "reconfirm" })
      : failure("/workflow-recover 需要工作流运行 ID 和 reconfirm。 ");
    case "memory": return noArguments(name, args, { kind: "memory" });
    case "memory-create": return args.length >= 2 && isMemoryScope(args[0])
      ? success({ kind: "memory-create", scope: args[0], text: joined(args.slice(1)) })
      : failure("/memory-create 需要 scope(session-auto/project/personal) 和正文。");
    case "memory-update": return args.length >= 2
      ? success({ kind: "memory-update", id: args[0], text: joined(args.slice(1)) })
      : failure("/memory-update 需要记忆 ID 和正文。");
    case "memory-enable": return parseToggle(name, args, "memory-enable", (id, enabled) => ({ kind: "memory-enable", id, enabled }));
    case "memory-delete": return args.length === 1
      ? success({ kind: "memory-delete", id: args[0] })
      : failure("/memory-delete 需要记忆 ID。");
    case "index":
      if (args.length === 0) return success({ kind: "index" });
      if (args[0] === "build" && args.length === 1) return success({ kind: "index", action: "build" });
      if (args[0] === "search" && args.length >= 2) return success({ kind: "index", action: "search", value: joined(args.slice(1)) });
      if (args[0] === "semantic" && args.length === 2 && (args[1] === "on" || args[1] === "off")) return success({ kind: "index", action: "semantic", value: args[1] === "on" });
      return failure("/index 只接受 build、search <词> 或 semantic <on|off>。");
    case "runs": return noArguments(name, args, { kind: "runs" });
    case "run-select": return args.length === 1
      ? success({ kind: "run-select", runId: args[0] })
      : failure("/run-select 需要一个运行 ID。");
    case "run-cancel": return args.length === 1
      ? success({ kind: "run-cancel", runId: args[0] })
      : failure("/run-cancel 需要一个运行 ID。");
    case "use": return oneOrMore(name, args, (session) => ({ kind: "use", session }));
    case "rename": return oneOrMore(name, args, (newName) => ({ kind: "rename", name: newName }));
    case "run": return oneOrMore(name, args, (prompt) => ({ kind: "run", prompt }));
    case "cancel": return noArguments(name, args, { kind: "cancel" });
    case "tokens": return noArguments(name, args, { kind: "tokens" });
    case "inbox": return noArguments(name, args, { kind: "inbox" });
    case "send":
      return atLeast(name, args, 2, () => ({ kind: "send", target: args[0], message: joined(args.slice(1)) }));
    case "delegate":
      return atLeast(name, args, 2, () => ({ kind: "delegate", target: args[0], task: joined(args.slice(1)) }));
    case "wait":
      return args.length <= 1
        ? success({ kind: "wait", source: args[0] })
        : failure("/wait 最多接受一个来源会话；名称含空格时请使用引号。");
    case "schedules": return noArguments(name, args, { kind: "schedules" });
    case "schedule-create": return args.length === 1 ? success({ kind: "schedule-create", draft: args[0] }) : failure("/schedule-create 需要一个 JSON 草案。");
    case "schedule-enable": return parseToggle(name, args, "schedule-enable", (id, enabled) => ({ kind: "schedule-enable", id, enabled }));
    case "schedule-run": return args.length === 1 ? success({ kind: "schedule-run", id: args[0] }) : failure("/schedule-run 需要任务 ID。");
    case "schedule-delete": return args.length === 1 ? success({ kind: "schedule-delete", id: args[0] }) : failure("/schedule-delete 需要任务 ID。");
    case "schedule-restore": return args.length === 1 ? success({ kind: "schedule-restore", id: args[0] }) : failure("/schedule-restore 需要任务 ID。");
    case "notifications": return noArguments(name, args, { kind: "notifications" });
    case "artifacts": return noArguments(name, args, { kind: "artifacts" });
    case "artifact-read": {
      if (args.length < 2 || args.length > 4) return failure("/artifact-read 需要产物 ID、运行 ID，以及可选偏移和字节数。 ");
      const offset = args[2] === undefined ? undefined : parseInteger(args[2], 0);
      const maxBytes = args[3] === undefined ? undefined : parseInteger(args[3], 1);
      if (offset === null || maxBytes === null) return failure("/artifact-read 的偏移必须为非负整数，字节数必须为正整数。 ");
      return success({ kind: "artifact-read", input: { artifactId: args[0], runId: args[1], ...(offset === undefined ? {} : { offset }), ...(maxBytes === undefined ? {} : { maxBytes }) } });
    }
    case "skills": return noArguments(name, args, { kind: "skills" });
    case "extensions": return noArguments(name, args, { kind: "extensions" });
    case "extension-stage": return args.length >= 1 && args.length <= 2
      ? success({ kind: "extension-stage", location: args[0], source: parseExtensionSource(args[1]) })
      : failure("/extension-stage 需要路径和可选来源。");
    case "extension-install": return args.length === 1 ? success({ kind: "extension-install", stagingId: args[0] }) : failure("/extension-install 需要暂存 ID。");
    case "extension-trust": return args.length === 2 ? success({ kind: "extension-trust", id: args[0], version: args[1] }) : failure("/extension-trust 需要扩展 ID 和版本。");
    case "extension-enable": return parseToggle(name, args, "extension-enable", (id, enabled) => ({ kind: "extension-enable", id, enabled }));
    case "extension-update": return args.length === 2 ? success({ kind: "extension-update", id: args[0], stagingId: args[1] }) : failure("/extension-update 需要扩展 ID 和暂存 ID。");
    case "extension-update-confirm": return args.length === 1 ? success({ kind: "extension-update-confirm", id: args[0] }) : failure("/extension-update-confirm 需要扩展 ID。");
    case "extension-rollback": return args.length === 1 ? success({ kind: "extension-rollback", id: args[0] }) : failure("/extension-rollback 需要扩展 ID。");
    case "extension-rollback-confirm": return args.length === 1 ? success({ kind: "extension-rollback-confirm", id: args[0] }) : failure("/extension-rollback-confirm 需要扩展 ID。");
    case "mcp-config": return args.length === 2 ? success({ kind: "mcp-config", id: args[0], endpoint: args[1] }) : failure("/mcp-config 需要 ID 和端点。");
    case "mcp-connect": return args.length === 1 ? success({ kind: "mcp-connect", id: args[0] }) : failure("/mcp-connect 需要 ID。");
    case "providers": return noArguments(name, args, { kind: "providers" });
    case "provider":
      return args.length === 2
        ? success({ kind: "provider", profile: args[0], model: args[1] })
        : failure("/provider 需要 profile 和 model 两个参数；含空格时请使用引号。");
    case "provider-endpoint": return args.length === 2 ? success({ kind: "provider-endpoint", profile: args[0], endpoint: args[1] }) : failure("/provider-endpoint 需要 profile 和端点。");
    case "provider-manual-model": return args.length === 2 ? success({ kind: "provider-manual-model", profile: args[0], model: args[1] }) : failure("/provider-manual-model 需要 profile 和模型。");
    case "provider-capabilities": return args.length === 2 ? success({ kind: "provider-capabilities", profile: args[0], capabilities: args[1] }) : failure("/provider-capabilities 需要 profile 和能力列表。");
    case "local-models": return noArguments(name, args, { kind: "local-models" });
    case "local-model-register": return args.length === 1 ? success({ kind: "local-model-register", registration: args[0] }) : failure("/local-model-register 需要 JSON 登记。");
    case "local-model-confirm": return args.length === 2 ? success({ kind: "local-model-confirm", id: args[0], version: args[1] }) : failure("/local-model-confirm 需要模型 ID 和版本。");
    case "local-model-update": return args.length === 2 ? success({ kind: "local-model-update", id: args[0], version: args[1] }) : failure("/local-model-update 需要模型 ID 和版本。");
    case "local-model-update-confirm": return args.length === 1 ? success({ kind: "local-model-update-confirm", id: args[0] }) : failure("/local-model-update-confirm 需要模型 ID。");
    case "permission": {
      const selection = args[0];
      const allowed = ["ask", "auto", "full"] as const;
      return args.length === 1 && allowed.some((value) => value === selection)
        ? success({ kind: "permission", selection: selection as (typeof allowed)[number] })
        : failure("/permission 只接受 ask（手动审核）、auto（自动审核）或 full（完全访问）。");
    }
    case "restore": return args.length === 1
      ? success({ kind: "restore", receiptId: args[0] })
      : failure("/restore 需要一个恢复回执 ID。");
    case "terminal-output": {
      if (args.length < 2 || args.length > 4 || (args[1] !== "stdout" && args[1] !== "stderr")) {
        return failure("/terminal-output 需要执行 ID、stdout|stderr，以及可选的非负偏移和正整数字节数。");
      }
      const offset = args[2] === undefined ? undefined : parseInteger(args[2], 0);
      const maxBytes = args[3] === undefined ? undefined : parseInteger(args[3], 1);
      if (offset === null || maxBytes === null) {
        return failure("/terminal-output 的偏移必须为非负整数，字节数必须为正整数。");
      }
      return success({
        kind: "terminal-output",
        executionId: args[0],
        stream: args[1],
        ...(offset === undefined ? {} : { offset }),
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });
    }
    case "workspace": return noArguments(name, args, { kind: "workspace" });
    case "review": return noArguments(name, args, { kind: "review" });
    case "settings": return noArguments(name, args, { kind: "settings" });
    case "diagnostics": return args.length <= 1 ? success({ kind: "diagnostics", runId: args[0] }) : failure("/diagnostics 最多接受一个运行 ID。");
    case "diagnostics-consent": return parseOnOff(name, args, (enabled) => ({ kind: "diagnostics-consent", enabled }));
    case "updates": {
      const channel = args[0] ?? "preview";
      return args.length <= 1 && (channel === "preview" || channel === "stable")
        ? success({ kind: "updates", channel })
        : failure("/updates 只接受 preview 或 stable。");
    }
    case "update-download": return noArguments(name, args, { kind: "update-download" });
    case "update-install": return noArguments(name, args, { kind: "update-install" });
    case "setting": return args.length >= 2 ? success({ kind: "setting", key: args[0], value: joined(args.slice(1)) }) : failure("/setting 需要键和值。");
    case "archive-export": return args.length === 1 ? success({ kind: "archive-export", path: args[0] }) : failure("/archive-export 需要一个目标路径。");
    case "archive-import": return args.length === 1 ? success({ kind: "archive-import", path: args[0] }) : failure("/archive-import 需要一个归档路径。");
    case "credential-export": return args.length === 1 ? success({ kind: "credential-export", path: args[0] }) : failure("/credential-export 需要一个目标路径；密码不会从命令参数读取。");
    case "credential-import": return args.length === 1 ? success({ kind: "credential-import", path: args[0] }) : failure("/credential-import 需要一个包路径；密码不会从命令参数读取。");
    case "quit": return noArguments(name, args, { kind: "quit" });
    default: return failure(`未知命令 '/${rawName ?? ""}'。输入 /help 查看可用命令。`);
  }
}

function tokenize(input: string): CliParseResult<string[]> {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else if (character === "\\" && quote === "\"" && (input[index + 1] === "\"" || input[index + 1] === "\\")) {
        current += input[index + 1];
        index += 1;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote) return failure("命令中的引号没有闭合。");
  if (current) tokens.push(current);
  return success(tokens);
}

function noArguments<T extends CliCommand>(name: string, args: string[], command: T): CliParseResult<T> {
  return args.length === 0 ? success(command) : failure(`/${name} 不接受额外参数。`);
}

function oneOrMore<T extends CliCommand>(
  name: string,
  args: string[],
  create: (value: string) => T,
): CliParseResult<T> {
  return args.length > 0 ? success(create(joined(args))) : failure(`/${name} 缺少必需参数。`);
}

function atLeast<T extends CliCommand>(
  name: string,
  args: string[],
  count: number,
  create: () => T,
): CliParseResult<T> {
  return args.length >= count ? success(create()) : failure(`/${name} 至少需要 ${count} 个参数。`);
}

function joined(values: string[]): string {
  return values.join(" ").trim();
}

function parseInteger(value: string, minimum: number): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function parseSessions(args: string[]): CliParseResult<Extract<CliCommand, { kind: "sessions" }>> {
  if (args.length === 0) return success({ kind: "sessions" });
  const filters: NonNullable<Extract<CliCommand, { kind: "sessions" }>['filters']> = {};
  const query: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--search" || argument === "--project" || argument === "--status" || argument === "--provider") {
      if (!value || value.startsWith("--")) return failure(`/sessions ${argument} 需要值。`);
      if (argument === "--search") filters.search = value;
      if (argument === "--project") filters.project = value;
      if (argument === "--status") filters.status = value;
      if (argument === "--provider") filters.providerId = value;
      index += 1;
      continue;
    }
    if (argument === "--offset" || argument === "--limit") {
      const parsed = value === undefined ? null : parseInteger(value, argument === "--limit" ? 1 : 0);
      if (parsed === null) return failure(`/sessions ${argument} 需要整数。`);
      if (argument === "--offset") filters.offset = parsed;
      else filters.limit = parsed;
      index += 1;
      continue;
    }
    query.push(argument);
  }
  return success({ kind: "sessions", ...(Object.keys(filters).length ? { filters } : {}), ...(query.length ? { query: joined(query) } : {}) });
}

function isMemoryScope(value: string | undefined): value is "session-auto" | "project" | "personal" {
  return value === "session-auto" || value === "project" || value === "personal";
}

function parseOnOff<T extends CliCommand>(name: string, args: string[], create: (enabled: boolean) => T): CliParseResult<T> {
  if (args.length === 1 && isOnOff(args[0])) return success(create(args[0] === "on"));
  return failure(`/${name} 需要 on 或 off。`);
}

function parsePreset(args: string[]): CliParseResult<CliCommand> {
  if (args.length === 0) return success({ kind: "preset" });
  if (args[0] === "copy") {
    const copied = parsePresetCopy(args.slice(1));
    return copied;
  }
  if (args[0] === "restore" && args.length === 1) return success({ kind: "preset-restore" });
  if (args[0] === "custom" && args.length >= 2) {
    return success({ kind: "preset", preset: "custom", name: joined(args.slice(1)) });
  }
  if (args.length === 1 && isCompositionPreset(args[0])) return success({ kind: "preset", preset: args[0] });
  return failure("/preset 只接受 standard、deepseek-efficient、minimal，或 custom <名称>。 ");
}

function parsePresetCopy(args: string[]): CliParseResult<Extract<CliCommand, { kind: "preset-copy" }>> {
  if (args.length < 2 || !isCompositionPreset(args[0])) return failure("/preset-copy 需要来源方案和自定义名称。 ");
  return success({ kind: "preset-copy", source: args[0], name: joined(args.slice(1)) });
}

function isCompositionPreset(value: string | undefined): value is CompositionPreset {
  return value === "standard" || value === "deepseek-efficient" || value === "minimal" || value === "custom";
}

function isOnOff(value: string | undefined): value is "on" | "off" {
  return value === "on" || value === "off";
}

function parseToggle<T extends CliCommand>(name: string, args: string[], _syntax: string, create: (id: string, enabled: boolean) => T): CliParseResult<T> {
  if (args.length === 2 && (args[1] === "on" || args[1] === "off")) return success(create(args[0], args[1] === "on"));
  return failure(`/${name} 需要 ID 和 on/off。`);
}

function parseExtensionSource(value: string | undefined): "local" | "custom" | "official" | "community" | "marketplace-fixture" | undefined {
  if (value === undefined) return undefined;
  return value === "local" || value === "custom" || value === "official" || value === "community" || value === "marketplace-fixture" ? value : undefined;
}

function success<T>(value: T): CliParseResult<T> {
  return { ok: true, value };
}

function failure<T = never>(message: string, output?: CliInvocation["output"]): CliParseResult<T> {
  return { ok: false, code: "CLI_USAGE", message, ...(output ? { output } : {}) };
}
