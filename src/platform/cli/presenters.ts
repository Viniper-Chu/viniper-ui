import { CliEvent, CliPresenter } from "./contracts";

export interface CliTextOutput {
  write(text: string): void;
  isTTY?: boolean;
}

export interface ChineseTtyPresenterOptions {
  color?: boolean;
}

export class JsonlPresenter implements CliPresenter {
  constructor(private readonly output: CliTextOutput) {}

  present(event: CliEvent): void {
    this.output.write(`${JSON.stringify(event)}\n`);
  }
}

export class ChineseTtyPresenter implements CliPresenter {
  private readonly color: boolean;
  private readonly streamingSessions = new Set<string>();

  constructor(
    private readonly output: CliTextOutput,
    options: ChineseTtyPresenterOptions = {},
  ) {
    this.color = options.color ?? output.isTTY === true;
  }

  present(event: CliEvent): void {
    const data = event.data;
    if (event.type !== "message.delta" && event.type !== "message.completed") {
      this.finishStream(event.sessionId);
    }
      switch (event.type) {
      case "ready":
        this.line(`${this.paint("cyan", "Viniper workstation CLI 已就绪")}。输入 /help 查看命令。`);
        break;
      case "help":
        this.help(data);
        break;
      case "error":
        this.line(`${this.paint("red", "错误")} [${stringValue(data.code, "UNKNOWN")}] ${stringValue(data.message)}`);
        break;
      case "sessions":
        this.sessions(data);
        break;
      case "routing":
        this.line(`智能分配：${booleanValue(recordValue(data.state)?.enabled) ? "开启" : "关闭"} · ${stringValue(recordValue(data.state)?.strategy, "balanced")}`);
        if (recordValue(recordValue(data.state)?.lastDecision)?.reason) this.line(`  ${stringValue(recordValue(recordValue(data.state)?.lastDecision)?.reason)}`);
        break;
      case "capabilities":
        this.capabilities(data);
        break;
      case "capabilities.changed":
        this.line(`能力方案已${stringValue(data.action, "更新")}：${stringValue(data.customName, stringValue(data.preset, "当前方案"))}。`);
        this.capabilities(data);
        break;
      case "steering.updated":
        this.line(`已向运行 ${stringValue(data.runId)} 投递下一步指令：${stringValue(recordValue(data.receipt)?.status, "已排队")}${stringValue(data.message) ? ` · ${stringValue(data.message)}` : ""}`);
        break;
      case "workflows":
        this.workflows(recordValue(data.snapshot));
        break;
      case "workflow.changed":
        this.line(`工作流已${stringValue(data.action, "更新")}。`);
        const changedRun = recordValue(data.run);
        if (changedRun) this.line(`  ${stringValue(changedRun.id)} · ${stringValue(changedRun.mode)} · ${stringValue(changedRun.status)}`);
        break;
      case "memory":
        this.simpleList("记忆", data.items, (item) => `${stringValue(item.source)} / ${stringValue(item.scope)} · ${stringValue(item.status)} · ${stringValue(item.text)}`);
        if (booleanValue(data.capacityWarning)) this.line("记忆容量接近软上限；应用不会自动删除条目。 ");
        break;
      case "memory.changed":
        this.line(`记忆已${stringValue(data.action, "更新")}；后续 run 使用同一应用端口状态。`);
        break;
      case "index":
        this.line(`项目索引：${stringValue(recordValue(data.state)?.status, "disabled")} · ${booleanValue(recordValue(data.state)?.explicit) ? "显式项目" : "未打开项目"}`);
        break;
      case "index.changed":
        this.line(`项目索引已${stringValue(data.action, "更新")}；结果来源由正式应用服务返回。`);
        if (data.result) this.line(JSON.stringify(data.result));
        break;
      case "runs":
        this.simpleList("当前运行", data.items, (item) =>
          `${stringValue(item.runId)} · ${stringValue(item.status)} · ${stringValue(item.origin)} · ${stringValue(item.text)}`);
        break;
      case "run.selected":
        this.line(`已选择运行 ${stringValue(data.runId)} · ${stringValue(data.status)}。`);
        break;
      case "run.cancel.requested":
        this.line(`已请求取消运行 ${stringValue(data.runId)}。`);
        break;
      case "session.created":
        this.line(`${this.paint("green", "已新建会话")}：${stringValue(data.title)} (${stringValue(data.id)}) · ${stringValue(data.projectRoot, "未打开项目")}`);
        break;
      case "session.selected":
        this.line(`当前会话：${this.paint("cyan", stringValue(data.title))} (${stringValue(data.id)}) · ${stringValue(data.projectRoot, "未打开项目")}`);
        break;
      case "session.renamed":
        this.line(`当前会话已重命名为：${this.paint("cyan", stringValue(data.title))}`);
        break;
      case "session.deleted":
        this.line(`已删除会话：${stringValue(data.title)}。项目文件未受影响。`);
        break;
      case "message.user":
        this.line(`${this.sessionPrefix(data)}${this.paint("blue", "任务")}：${stringValue(data.text)}`);
        break;
      case "message.delta":
        this.messageDelta(event.sessionId, data);
        break;
      case "message.completed":
        this.finishMessage(event.sessionId, data);
        break;
      case "message.cancelled":
        this.finishStream(event.sessionId);
        this.line(`${this.sessionPrefix(data)}回复保留到取消位置。`);
        break;
      case "thinking.started":
        this.line(`${this.sessionPrefix(data)}${this.paint("blue", "执行阶段")}：${stringValue(data.title, "正在思考")}`);
        break;
      case "thinking.delta":
        this.line(`${this.sessionPrefix(data)}${this.paint("dim", stringValue(data.text))}`);
        break;
      case "thinking.completed":
        this.line(`${this.sessionPrefix(data)}执行阶段完成。`);
        break;
      case "tool.requested":
        this.line(`${this.sessionPrefix(data)}${this.paint("yellow", "工具")}：${stringValue(data.title)} · ${stringValue(data.status)}`);
        if (stringValue(data.detail)) this.line(`  ${this.paint("dim", stringValue(data.detail))}`);
        break;
      case "tool.completed":
        this.line(`${this.sessionPrefix(data)}${this.paint("green", "工具完成")}：${stringValue(data.title)}`);
        if (stringValue(data.result)) this.line(`  ${stringValue(data.result)}`);
        this.toolPresentation(data.presentation);
        break;
      case "tool.cancelled":
        this.line(`${this.sessionPrefix(data)}${this.paint("yellow", "工具已取消")}：${stringValue(data.title)}`);
        if (stringValue(data.result)) this.line(`  ${stringValue(data.result)}`);
        this.toolPresentation(data.presentation);
        break;
      case "tool.failed":
        this.line(`${this.sessionPrefix(data)}${this.paint("red", "工具未完成")}：${stringValue(data.title)}`);
        if (stringValue(data.result)) this.line(`  ${stringValue(data.result)}`);
        this.toolPresentation(data.presentation);
        break;
      case "interaction.requested":
        this.line(`${this.sessionPrefix(data)}${this.paint("yellow", "需要处理")}：${stringValue(data.title)} · ${stringValue(data.detail)}`);
        break;
      case "run.started":
        this.line(`${this.sessionPrefix(data)}${this.paint("blue", "开始执行")} (${stringValue(data.runId)})`);
        break;
      case "run.queued":
        this.line(`${this.sessionPrefix(data)}任务已进入当前会话队列。`);
        break;
      case "run.completed":
        this.finishStream(event.sessionId);
        this.line(`${this.sessionPrefix(data)}${this.paint("green", "运行完成")} (${stringValue(data.runId)})`);
        break;
      case "run.cancelled":
        this.finishStream(event.sessionId);
        this.line(`${this.sessionPrefix(data)}${this.paint("yellow", "运行已取消")} (${stringValue(data.runId)})`);
        break;
      case "run.failed":
        this.finishStream(event.sessionId);
        this.line(`${this.sessionPrefix(data)}${this.paint("red", "运行失败")}：${stringValue(data.detail, "未提供错误详情")}`);
        break;
      case "run.listener-failed":
        this.line(`${this.sessionPrefix(data)}${this.paint("yellow", "后续处理失败")}：${stringValue(data.detail)}`);
        break;
      case "queue.updated":
        this.line(`${this.sessionPrefix(data)}当前排队：${numberValue(data.count)} 项。`);
        break;
      case "cancel.requested":
        this.line(`${this.sessionPrefix(data)}已请求取消当前${stringValue(data.target, "运行")}。`);
        break;
      case "tokens":
        this.tokens(data);
        break;
      case "inbox":
        this.inbox(data);
        break;
      case "coordination.sent":
        this.line(`消息已发送至 ${stringValue(data.targetTitle)} (${stringValue(data.targetSessionId)})。`);
        break;
      case "coordination.delegated":
        this.line(`任务已委派给 ${stringValue(data.targetTitle)} (${stringValue(data.targetSessionId)})。`);
        break;
      case "coordination.waiting":
        this.line(`当前会话正在等待${stringValue(data.sourceTitle) ? ` ${stringValue(data.sourceTitle)} 的` : ""}消息。`);
        break;
      case "coordination.matched":
        this.line(`已匹配现有消息 (${stringValue(data.envelopeId)})，未进入等待。`);
        break;
      case "schedules":
        this.simpleList("自动任务", data.items, (item) =>
          `${stringValue(item.name)} · ${booleanValue(item.enabled) ? "启用" : "暂停"} · ${stringValue(item.nextRun, "无下次时间")}`);
        break;
      case "schedule.changed":
        this.line(`自动任务已${stringValue(data.action, "更新")}。`);
        break;
      case "skills":
        this.simpleList("Skills", data.items, (item) =>
          `${stringValue(item.name)} (${stringValue(item.id)}) · ${booleanValue(item.enabled) ? "当前会话已启用" : "未启用"}`);
        break;
      case "extensions":
        this.simpleList("扩展中心", data.items, (item) => {
          const capabilities = arrayValue(item.capabilities).map((capability) => stringValue(capability)).join("、") || "无声明能力";
          return `${stringValue(item.name)} (${stringValue(item.id)}) · ${stringValue(item.source)} · 当前 ${stringValue(item.version, "未安装")} · 上一版 ${stringValue(item.previous, "无")} · ${stringValue(item.trust)} · ${stringValue(item.status)} · ${capabilities}`;
        });
        this.line(this.paint("dim", stringValue(data.policy)));
        break;
      case "extension.changed":
        this.line(`扩展已${stringValue(data.action, "更新")}；信任与执行权限仍分离。`);
        break;
      case "mcp.changed":
        this.line(`MCP 已${stringValue(data.action, "更新")}；仅使用用户明确配置的本地端点。`);
        break;
      case "providers":
        this.simpleList("Providers", data.items, (item) => {
          const models = arrayValue(item.models).map((model) => stringValue(model)).join("、") || "无可选模型";
          return `${stringValue(item.name)} (${stringValue(item.id)}) · ${stringValue(item.configuration)} · ${models}`;
        });
        this.line(this.paint("dim", "Preview 限制：CLI 真实 Provider 凭据接入未完成，不复用桌面 safeStorage 密钥；仅 Demo/local fake 可运行。"));
        this.line(this.paint("dim", "权限：ask 手动审核、auto 自动审核、full 完全访问；CLI 不提供交互批准（fail-closed），ask 会明确拒绝。"));
        break;
      case "provider.selected":
        this.line(`当前会话已选择：${stringValue(data.providerName)} / ${stringValue(data.model)}`);
        break;
      case "provider.changed":
        this.line(`Provider 设置已${stringValue(data.action, "更新")}：${stringValue(data.providerId)}。`);
        break;
      case "local-models":
        this.simpleList("本地模型", recordArray(recordValue(data.localModels)?.records), (item) =>
          `${stringValue(item.label)} (${stringValue(item.id)}) · ${stringValue(item.source)} · ${stringValue(item.status)} · 工具 ${stringValue(item.toolCapability, "none")}`);
        this.line(this.paint("dim", "本地模型默认关闭云端回退；本轮只允许 loopback/受管 runner。"));
        break;
      case "permission.selected":
        this.line(`当前权限：${this.paint("cyan", stringValue(data.message, stringValue(data.selection)))}`);
        break;
      case "terminal.output":
        this.line(`终端输出 · ${stringValue(data.executionId)} · ${stringValue(data.stream)} · ${numberValue(data.offset)}–${numberValue(data.offset) + numberValue(data.bytes)} / ${numberValue(data.totalBytes)} 字节`);
        if (stringValue(data.text)) this.line(stripAnsi(stringValue(data.text)));
        if (data.nextOffset !== null) this.line(this.paint("dim", `继续偏移：${numberValue(data.nextOffset)}`));
        break;
      case "workspace":
        this.simpleList("工作区", data.items, (item) =>
          `${stringValue(item.mode)} · ${stringValue(item.status)} · ${stringValue(item.reviewOutcome, "未审查")} · ${booleanValue(item.checksPassed) ? "检查通过" : "检查未通过"}`);
        break;
      case "review":
        this.simpleList("自动审查", data.items, (item) =>
          `${stringValue(item.outcome)} · ${stringValue(item.providerId)}/${stringValue(item.modelId)} · 第 ${numberValue(item.round)} 轮`);
        break;
      case "settings":
        this.line(`产品设置：${JSON.stringify(data.settings)}`);
        break;
      case "setting.changed":
        this.line(`产品设置已更新：${stringValue(data.key)}。`);
        break;
      case "diagnostics":
        this.line(`诊断预览：${recordArray(recordValue(data.preview)?.fields).length} 条；消息/命令/凭据正文均不导出。`);
        break;
      case "diagnostics.consent":
        this.line(`匿名诊断同意：${booleanValue(data.enabled) ? "开启" : "关闭"}；${stringValue(data.upload)}`);
        break;
      case "updates":
        this.line(`更新：${stringValue(recordValue(data.state)?.status, "unavailable")} · ${stringValue(recordValue(data.state)?.channel, "preview")} · ${booleanValue(recordValue(data.state)?.officialSourceConfigured) ? "已配置来源" : "未配置官方源"}`);
        break;
      case "update.changed":
        this.line(`更新操作：${stringValue(data.action)}；${JSON.stringify(data.state ?? {})}`);
        break;
      case "archive.exported":
        this.line(`非秘密归档已导出：${stringValue(data.path)}。`);
        break;
      case "archive.preview":
        this.line(`归档已暂存并完成冲突预览：${JSON.stringify(data.preview)}`);
        break;
      case "credential.boundary":
        this.line(`密钥包${stringValue(data.action)}：${stringValue(data.message)}`);
        break;
      case "quit":
        this.line(stringValue(data.message, "CLI 已退出。"));
        break;
    }
  }

  private help(data: Readonly<Record<string, unknown>>): void {
    this.line(this.paint("cyan", "Viniper workstation CLI"));
    this.line("  人类模式：npm run cli --");
    this.line("  纯文本模式：npm run --silent cli -- run --prompt \"整理当前任务\" --plain");
    this.line("  机器 JSONL：npm run --silent cli -- run --prompt \"整理当前任务\" --jsonl（兼容 --json）");
    this.line("  可选：--data-root=<目录>（npm 调用建议等号形式；目录占用时拒绝双写）");
    this.line("  项目：--project=<目录>（默认当前工作目录；项目根由应用装配校验）");
    for (const command of recordArray(data.commands)) {
      this.line(`  ${stringValue(command.syntax).padEnd(30)} ${stringValue(command.description)}`);
    }
    this.line("  普通非斜杠输入会直接交给当前 Agent 会话。 ");
    this.line(this.paint("dim", "Preview 限制：CLI 不复用桌面 safeStorage 密钥，仅 Demo/local fake 可运行。"));
    this.line(this.paint("dim", "权限：ask 手动审核、auto 自动审核、full 完全访问；CLI 不提供交互批准（fail-closed），ask 会明确拒绝。"));
  }

  private toolPresentation(value: unknown): void {
    const presentation = recordValue(value);
    const kind = stringValue(presentation?.kind);
    if (kind.startsWith("project-")) this.projectPresentation(presentation);
    else if (kind.startsWith("terminal-")) this.terminalPresentation(presentation);
  }

  private projectPresentation(value: unknown): void {
    const presentation = recordValue(value);
    if (!presentation || !stringValue(presentation.kind).startsWith("project-")) return;
    const paths = arrayValue(presentation.paths).map((path) => stringValue(path)).filter(Boolean);
    if (paths.length) this.line(`  文件：${paths.join(" → ")}`);
    const patch = stringValue(presentation.patch);
    if (patch) {
      this.line(`  差异${booleanValue(presentation.patchTruncated) ? "（有界片段，可继续读取）" : ""}：`);
      for (const line of patch.split(/\r?\n/u)) this.line(`    ${line}`);
    }
    if (stringValue(presentation.recoveryReceiptId)) {
      this.line(`  恢复回执：${stringValue(presentation.recoveryReceiptId)} · ${stringValue(presentation.recoveryStatus)}`);
    }
  }

  private terminalPresentation(value: unknown): void {
    const presentation = recordValue(value);
    if (!presentation) return;
    const status = stringValue(presentation.status);
    const exitCode = presentation.exitCode === null ? "无" : String(numberValue(presentation.exitCode));
    this.line(`  终端：${status} · exit ${exitCode} · ${numberValue(presentation.durationMs)} ms · ${stringValue(presentation.executionId)}`);
    for (const stream of ["stdout", "stderr"] as const) {
      const output = recordValue(presentation[stream]);
      if (!output) continue;
      this.line(`  ${stream}：${numberValue(output.totalBytes)} 字节${booleanValue(output.truncated) ? " · 已截断，可续读" : ""}`);
      const preview = stripAnsi(stringValue(output.preview));
      if (preview) this.line(`    ${preview.slice(0, 600).replace(/\r?\n/gu, "\n    ")}${preview.length > 600 ? "…" : ""}`);
    }
  }

  private sessions(data: Readonly<Record<string, unknown>>): void {
    const sessions = recordArray(data.items);
    if (sessions.length === 0) {
      this.line("暂无会话。 ");
      return;
    }
    this.line("会话：");
    for (const session of sessions) {
      const marker = booleanValue(session.active) ? "*" : " ";
      this.line(` ${marker} ${stringValue(session.title)} (${stringValue(session.id)}) · ${stringValue(session.status)} · ${stringValue(session.providerId)}/${stringValue(session.model)} · ${stringValue(session.projectRoot, "未打开项目")}`);
    }
  }

  private tokens(data: Readonly<Record<string, unknown>>): void {
    const estimate = recordValue(data.currentEstimate);
    const provider = recordValue(data.providerFinal);
    this.line(`Token · ${stringValue(data.sessionTitle)}：`);
    this.line(estimate
      ? `  实时估算：约 ${numberValue(estimate.total)}（输入 ${numberValue(estimate.input)} / 输出 ${numberValue(estimate.output)}）`
      : "  实时估算：当前没有运行中的估算");
    this.line(provider
      ? `  Provider 实际：${numberValue(provider.total)}（输入 ${numberValue(provider.input)} / 输出 ${numberValue(provider.output)} / 缓存命中 ${optionalNumber(provider.cacheHitInput)}）`
      : "  Provider 实际：最近运行尚未提供权威 usage");
    const cumulative = recordValue(data.sessionCumulative);
    if (cumulative) this.line(`  会话累计：${numberValue(cumulative.total)}（来源可能混合，不能当作单次账单）`);
  }

  private inbox(data: Readonly<Record<string, unknown>>): void {
    const items = recordArray(data.items);
    if (!items.length) {
      this.line("当前会话收件箱为空。 ");
      return;
    }
    this.line(`收件箱 · ${stringValue(data.sessionTitle)}：`);
    for (const item of items) {
      this.line(`  [${stringValue(item.type)} / ${stringValue(item.status)}] ${stringValue(item.sourceTitle)}：${stringValue(item.body)}`);
    }
  }

  private capabilities(data: Readonly<Record<string, unknown>>): void {
    const center = recordValue(data.center);
    const current = recordValue(center?.current);
    this.line(`能力方案：${stringValue(current?.customName, stringValue(current?.preset, "未加载"))} · ${stringValue(current?.presentation && recordValue(current.presentation)?.summary)}`);
    for (const preset of recordArray(center?.presets)) {
      const marker = stringValue(preset.id) === stringValue(current?.preset) ? "*" : "-";
      this.line(` ${marker} ${stringValue(preset.label)} · ${stringValue(preset.purpose)} · 模型 ${arrayValue(preset.modelRecommendations).map((item) => stringValue(item)).join("、")}`);
      this.line(`   能力：${arrayValue(preset.capabilities).map((item) => stringValue(item)).join("、") || "暂无"} · ${stringValue(preset.frozen)}`);
      if (arrayValue(preset.blockers).length) {
        this.line(`   阻塞原因：${arrayValue(preset.blockers).map((item) => stringValue(item)).join("；")}`);
      } else if (arrayValue(preset.dependencies).length || arrayValue(preset.conflicts).length) {
        this.line(`   依赖/冲突：${arrayValue(preset.dependencies).concat(arrayValue(preset.conflicts)).map((item) => stringValue(item)).join("、")}`);
      }
    }
    const custom = recordArray(center?.custom);
    if (custom.length) {
      this.line(" 自定义方案：");
      for (const item of custom) this.line(`   ${stringValue(item.name)} · ${arrayValue(item.enabledIds).length} 项`);
    }
  }

  private workflows(value: Readonly<Record<string, unknown>> | undefined): void {
    if (!value) {
      this.line("工作流服务未提供。 ");
      return;
    }
    const definitions = recordArray(value.definitions);
    const runs = recordArray(value.runs);
    this.line("工作流：");
    if (!definitions.length) this.line("  暂无定义。 ");
    for (const definition of definitions) this.line(`  - ${stringValue(definition.id)} · ${stringValue(definition.name)} · ${stringValue(definition.mode)}`);
    if (runs.length) {
      this.line("运行：");
      for (const run of runs) this.line(`  - ${stringValue(run.id)} · ${stringValue(run.mode)} · ${stringValue(run.status)}`);
    }
  }

  private simpleList(
    title: string,
    value: unknown,
    format: (item: Readonly<Record<string, unknown>>) => string,
  ): void {
    const items = recordArray(value);
    this.line(`${title}：`);
    if (!items.length) {
      this.line("  暂无定义。 ");
      return;
    }
    for (const item of items) this.line(`  - ${format(item)}`);
  }

  private messageDelta(sessionId: string | undefined, data: Readonly<Record<string, unknown>>): void {
    const key = sessionId ?? "unknown";
    if (!this.streamingSessions.has(key)) {
      this.output.write(`${this.sessionPrefix(data)}${this.paint("cyan", "回复")}：`);
      this.streamingSessions.add(key);
    }
    this.output.write(stringValue(data.text));
  }

  private finishMessage(sessionId: string | undefined, data: Readonly<Record<string, unknown>>): void {
    const key = sessionId ?? "unknown";
    if (this.streamingSessions.has(key)) {
      this.finishStream(sessionId);
      return;
    }
    const text = stringValue(data.text);
    if (text) this.line(`${this.sessionPrefix(data)}${this.paint("cyan", "回复")}：${text}`);
  }

  private finishStream(sessionId: string | undefined): void {
    const key = sessionId ?? "unknown";
    if (!this.streamingSessions.delete(key)) return;
    this.output.write("\n");
  }

  private sessionPrefix(data: Readonly<Record<string, unknown>>): string {
    const title = stringValue(data.sessionTitle);
    return title ? `[${title}] ` : "";
  }

  private line(text: string): void {
    this.output.write(`${text}\n`);
  }

  private paint(color: "red" | "green" | "yellow" | "blue" | "cyan" | "dim", text: string): string {
    if (!this.color || !text) return text;
    const code = { red: 31, green: 32, yellow: 33, blue: 34, cyan: 36, dim: 2 }[color];
    return `\u001B[${code}m${text}\u001B[0m`;
  }
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function recordArray(value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return Array.isArray(value)
    ? value.map(recordValue).filter((item): item is Readonly<Record<string, unknown>> => Boolean(item))
    : [];
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): string {
  return value === null || value === undefined ? "未提供" : String(numberValue(value));
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B](?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/gu, "");
}
