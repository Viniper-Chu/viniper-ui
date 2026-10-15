import { AgentEngineSnapshot } from "../../core/agent-engine-contracts";
import { ClaudeCodeProbeResult } from "../../core/agent-engine-contracts";
import { ProviderRegistry } from "../providers/provider-registry";

const COMMON_ACTIONS: AgentEngineSnapshot["commonActions"] = [
  "create-session",
  "open-project",
  "send",
  "cancel",
  "rename",
  "set-model",
  "set-permission",
];

export class AgentEngineCatalog {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly claudeCode: ClaudeCodeProbeResult,
  ) {}

  snapshot(): AgentEngineSnapshot[] {
    const claudeProvider = this.providers.list().find((provider) => provider.id === "claude-code");
    const claudeReady = this.claudeCode.available && claudeProvider?.available === true;
    const engines: AgentEngineSnapshot[] = [
      {
        id: "viniper",
        name: "Viniper",
        runtime: "harness-runtime",
        status: "ready",
        transport: "application-port",
        summary: "自研 Harness Runtime；会话、工具、权限与事件由单一 Application Port 管理。",
        commonActions: [...COMMON_ACTIONS],
        capabilities: [
          capability("conversation", "会话", "supported", "结构化会话与事件真源"),
          capability("streaming", "流式输出", "supported", "RuntimeEvent 增量投影"),
          capability("tools", "工具", "supported", "Harness ToolRegistry 与权限策略"),
          capability("permissions", "权限", "supported", "手动、自动与完全访问"),
          capability("queue", "队列", "supported", "会话内排队与多运行调度"),
          capability("cancel", "取消", "supported", "按 run 取消"),
          capability("steering", "运行中引导", "supported", "steer / inject"),
          capability("attachments", "附件", "supported", "桌面原生选择附件；按模型与工具能力读取文件"),
        ],
      },
      {
        id: "claude-code",
        name: "Claude code",
        runtime: "claude-code-adapter",
        status: claudeReady ? "ready" : "unavailable",
        ...(this.claudeCode.version ? { version: this.claudeCode.version } : {}),
        transport: this.claudeCode.transport,
        summary: claudeReady
          ? "Claude Code CLI 由独立 Engine Adapter 执行；Renderer 仍只调用统一 Application Port。"
          : this.claudeCode.message,
        commonActions: [...COMMON_ACTIONS],
        capabilities: [
          capability("conversation", "会话", claudeReady ? "adapter" : "unavailable", "engineId 分区的规范会话；CLI 不持久化第二份会话"),
          capability("streaming", "流式输出", claudeReady ? "adapter" : "unavailable", "stream-json 映射为 RuntimeEvent"),
          capability("tools", "工具", claudeReady ? "adapter" : "unavailable", "只由 Claude Code CLI 原生执行；不进入 Viniper ToolRegistry"),
          capability("permissions", "权限", claudeReady ? "adapter" : "unavailable", "会话控件直接映射到 CLI 原生权限模式；不进入 Viniper PermissionPolicy"),
          capability("queue", "队列", claudeReady ? "supported" : "unavailable", "统一 Runtime owner 内按 engineId 分区调度"),
          capability("cancel", "取消", claudeReady ? "supported" : "unavailable", "AbortSignal 终止适配器进程"),
          capability("steering", "运行中引导", "unproven", "CLI 单次 print 运行不宣称实时 steer 等价"),
          capability("attachments", "附件", "unproven", "当前桌面输入区尚未开放附件选择"),
        ],
      },
    ];
    return this.claudeCode.available ? engines : engines.filter(engine => engine.id === "viniper");
  }
}

function capability(
  id: AgentEngineSnapshot["capabilities"][number]["id"],
  label: string,
  status: AgentEngineSnapshot["capabilities"][number]["status"],
  note: string,
): AgentEngineSnapshot["capabilities"][number] {
  return { id, label, status, note };
}
