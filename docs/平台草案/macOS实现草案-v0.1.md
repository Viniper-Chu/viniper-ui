# macOS 实现草案 v0.1

当前状态：`UNPROVEN / 无 Mac 真机`。本文件确保 Windows 实现不把 macOS 锁死，不代表已经打包或运行成功。

## 与 Windows 共用

- 共用 TypeScript 领域层、会话状态机、Provider 适配器、缓存规划、JSON/NDJSON 数据协议、渲染器和绝大多数测试。
- 共用 Electron 主进程与 preload API，平台差异统一进入 `PlatformBridge`，不在界面散布平台判断。
- 打包目标同时保留 macOS arm64 与 x64；版本、数据迁移和更新协议保持一致。

## macOS 平台适配

- 标题栏采用 `hiddenInset`，窗口控制区保留安全间距；菜单使用 macOS 原生 application menu。
- 当前产品没有 shell 或命令执行能力；若未来另有授权，macOS 才需通过平台桥评估用户登录 shell 与受控 `spawn`。
- 密钥通过 Electron `safeStorage` 对接 Keychain；Windows 同接口对接 DPAPI。
- 数据目录使用 `app.getPath('userData')`；正式与 Preview 必须隔离。
- 托盘使用 Template Image；关闭窗口与退出应用遵守 macOS 常见行为。
- 文件/目录访问、通知、麦克风等能力只在真实功能需要时申请对应权限。
- 更新与签名最终需要 Apple Developer ID、notarization 和签名后的 arm64/x64 制品；这些都属于后续用户授权与真机阶段。

## 每阶段同步检查

- 新增 Node 原生依赖是否提供 darwin arm64/x64 构建。
- 是否出现 Windows 专用路径、PowerShell 命令或窗口 API 泄漏到领域层。
- 快捷键是否使用 `CommandOrControl`，菜单和焦点行为是否可在 macOS 映射。
- 打包资源、图标、权限描述和自动更新是否有 macOS 对应草案。
- 所有未真机运行的判断保持 `UNPROVEN`。

## CP1 同步差异（2026-08-12）

- Phase 1 计划采用 Windows 与 macOS 共用的 TypeScript domain、session snapshot/event journal、Runtime、Provider 适配器、CachePlan 和 preload 合同；平台差异继续收口在 `PlatformBridge` 与 Electron 主进程。
- CP1 只冻结模块职责、接口和依赖方向，未新增生产实现、原生依赖或打包配置；因此本轮没有需要在 macOS 上实际运行的新增能力。
- macOS 仍为 `UNPROVEN / 无 Mac 真机`，后续生产实现必须继续检查 darwin arm64/x64 原生依赖、标题栏安全区、Keychain/safeStorage、数据目录隔离和签名边界。

## Phase 1 范围变更同步（2026-08-12）

- 产品收敛为单一 Agent 工作区，macOS 与 Windows 共用的领域合同移除 Chat/Agent 模式字段与模式切换状态；这减少了两端菜单、快捷键和恢复逻辑的分叉。
- 渲染器改为功能域目录，macOS 只需要在 `platform/desktop` 处理标题栏、菜单、托盘、快捷键和数据目录差异，不在各 UI 功能目录散布平台判断。
- Windows Electron 42.3.1 的可运行结果不能证明 macOS 依赖、打包或原生行为；本阶段 macOS 继续保持 `UNPROVEN / 无 Mac 真机`。

## 版本阶段同步（2026-08-12）

- Windows 与未来 macOS 包共用产品版本 `0.0.1` 和 `Preview` 渠道标识；macOS 草案不得提前使用 Beta、公测、RC 或正式版名称。
- 当前没有 macOS 安装包、签名、公证或更新通道，因此“macOS v0.0.1 Preview”只表示预定元数据合同，仍为 `UNPROVEN`。

## CP2 实现差异同步（2026-08-12）

- Windows 已落地纯 Agent 的 `core / features / platform / renderer` 功能目录；领域合同、IPC、snapshot 与持久化均不含产品模式字段。该 TypeScript 结构可供未来 macOS 共用，但尚未在 Mac 上加载。
- 当前文件存储为轻量 `sessions.json` canonical snapshot + `events.ndjson` append-only journal，数据根按 `Agent Desktop/Preview-0.0.1` 隔离；这是当前实现事实。ADR-0032 已把后续目标改为 SQLite 结构化真源 + 受管文件产物，但尚未实施迁移，也未验证 macOS 路径、权限、数据库锁、落盘与异常退出恢复。
- 当前除 Electron 42.3.1 外没有新增原生业务依赖。主进程已保留 macOS 的 `activate`/窗口关闭分支；Windows 专用的隐藏应用菜单受平台判断约束，不会直接套用到 macOS。
- Phase 1 收口时尚无 shell、真实文件工具、真实 Provider、密钥存储、托盘、自动更新、安装包、签名或公证能力；后续 Phase 2 差异以下一节为准。
- `v0.0.1 · Preview（预览版）` 已在 Windows 标题和设置/关于实际显示；macOS 对应标题栏安全区、原生菜单、快捷键、arm64/x64 包与视觉结果仍为 `UNPROVEN / 无 Mac 真机`。

## Phase 2 v0.3 差异同步（2026-08-12）

- 多会话并行由每会话独立运行控制与队列实现；coordination 信封、Token ledger、schedule 定义/历史、extension metadata、secret references 均为平台无关合同及独立 JSON/NDJSON 文件。Windows 已验证的并行和恢复不能替代 macOS 文件锁、休眠唤醒或应用生命周期验证。
- 自动任务明确只在应用运行时执行。未来 macOS 需验证窗口关闭但应用仍存活、`activate`、睡眠/唤醒与本地时区变化；不得把当前实现表述为 LaunchAgent 或退出后系统服务。
- `safeStorage` 适配器使用异步加密/解密接口，renderer 只有写入、删除和 configured 状态；秘密本体不进入 snapshot、event journal 或普通设置文件。未来 macOS 应由同一端口落到 Keychain，但真实保存、迁移、锁屏与账户切换仍为 `UNPROVEN`。
- DeepSeek 适配器、本地 fake SSE 合同和 Provider-neutral usage 位于平台无关功能域；本阶段公网调用为 0。macOS 网络栈、代理、证书、取消和真实 Provider 内容均未验证。
- Skill 采用元数据扫描、启用运行时按需读取正文；插件只执行项目内置 coordination 能力，external-declarative 与 invalid 清单不执行。macOS 需继续检查打包后 skills/plugins 资源路径和只读性。
- Windows 已观察协作星图、Token 脉搏、自动任务、扩展与 SecretField 的大窗/960×720 布局；macOS 的 `hiddenInset` 安全区、原生菜单、VoiceOver、Command 快捷键、reduced-motion 和同尺寸视觉仍为 `UNPROVEN / 无 Mac 真机`。
- core 与 features 中未引入 Windows 盘符、PowerShell 或 DPAPI 语义；Windows Electron 组合层的文件路径与测试环境变量没有进入 core。Electron `safeStorage` 的平台实现差异继续封装在 `platform/security`。
- 当前仍无 macOS 安装包、arm64/x64 打包验证、签名、公证、自动更新或真机运行，因此 macOS 总状态保持 `UNPROVEN`。

## Phase 3 v0.4 预先差异合同（2026-08-12）

- 五个协议族、Provider profiles、结构化消息、工具循环、缓存策略和错误映射必须保持纯 TypeScript 与平台无关；core/features 内不得出现 Windows 盘符、PowerShell、注册表或 DPAPI 专属语义。
- Provider endpoint、区域和模型 ID 都来自 profile/settings，不能依赖 Windows 环境变量或路径。网络取消采用标准 `AbortSignal`，不依赖平台进程控制。
- 每个 profile 的秘密继续经同一个 SecretVault 端口进入 Electron `safeStorage`；macOS 预定由 Keychain 承担底层保护，但多字段凭据、重加密、锁屏/账户切换仍需真机验证。
- Gemini Interactions 按 ADR-0049 默认使用本地历史并关闭服务端状态，不因 macOS 改变；只有具体 profile 明确开启且端点支持时才使用，关闭不冒充远程删除。`store=false` 仅在真实协议支持时投射。
- 协议族 fake、profile 合同与纯领域工具循环测试应能在 darwin 跑；Windows 界面和测试通过不能证明 macOS 代理、TLS、Keychain、菜单、VoiceOver 或睡眠唤醒。
- 后续打包需分别验证 arm64/x64、原生依赖、签名、公证与更新通道。本阶段继续保持 `UNPROVEN / 无 Mac 真机`。

## Phase 3 v0.4/v0.5/v0.6 实施同步（2026-08-12）

- 结构化 Provider 历史、统一工具循环、五个协议族、28 个 profiles、缓存策略与 usage 对账均位于 `core/features` 的纯 TypeScript 边界；协议网络层使用标准 `fetch`/`AbortSignal`。当前 core/features 静态检查未发现 Windows 盘符、PowerShell、注册表或 DPAPI 语义。
- OpenAI Responses、Anthropic Messages、Gemini Interactions、OpenAI Chat 与 SenseNova 的本地 fake 合同可跨平台复用；Windows 的 localhost fake PASS 不证明 macOS 代理、TLS、系统证书、网络取消或任何真实厂商 API 行为，真实 Provider 继续为 `REAL_API_UNPROVEN`。
- 桌面 per-profile SecretVault 仍由 Electron `safeStorage` 适配。Windows 只用合成值观察了写入、configured、不回显与删除；macOS Keychain 的多字段凭据、锁屏、账户切换、迁移和删除仍须真机验证。
- CLI 通过中立 `createHarnessApplication` 工厂调用与桌面相同的正式应用服务，不复制 Runtime、协作、Token、调度或 Skills 状态机，也不依赖 Electron。当前 CLI v0.0.1 Preview 的 vault 明确 fail-closed，不读取或复用桌面秘密；后续目标已由 ADR-0031 收敛为当前用户范围 Unix domain socket、单一 Runtime 所有者和 Keychain `PlatformCredentialVault`，不是永久 Harness 守护进程。
- CLI 单写者租约使用 Node 文件独占创建和进程存活探测；Windows 已验证同数据根拒绝双写。macOS 的 stale lock、PID 复用、Ctrl+C、TTY/JSONL 编码和终端关闭行为仍为 `UNPROVEN`。
- 批准稿四区界面（左会话栏、中央执行时间线、一体 Composer、右上下文栏）继续共用 renderer；Windows 已真实观察 1440×900 与约 960×720。macOS 的 `hiddenInset`、交通灯安全区、原生菜单、VoiceOver、Command 快捷键、缩放和同尺寸视觉仍为 `UNPROVEN`。
- 当前没有 macOS arm64/x64 构建、安装器、签名、公证、自动更新或真机终端证据；macOS 总状态保持 `UNPROVEN / 无 Mac 真机`。

## Phase 4 v0.7 品牌与可读性同步（2026-08-12）

- 用户可见产品名统一为 `Viniper Harness`，版本仍为 `v0.0.1 · Preview（预览版）`。Windows 与 CLI 已完成替换；内部 `Agent Desktop/Preview-0.0.1` 和 `Agent Desktop CLI/Preview-0.0.1` 只作为旧 Preview 数据兼容别名保留，不迁移或删除数据。macOS 实际数据目录兼容、升级与回滚仍为 `UNPROVEN`。
- renderer 已使用平台无关的冷青设计令牌：画布 `#F4FAF9`、表面 `#FFFFFF`、浅冰青 `#E6F5F7`、浅薄荷 `#DDF5EF`、主青 `#168A91`、亮青 `#22B8B5`、深青 `#116B73`、深蓝黑 `#15343B`、次级文字 `#5E7478`、分隔线 `#D7E7E5`。Windows 主按钮以 `#116B73` 配白字；macOS 色彩管理、对比度、深浅色系统设置和显示器差异尚未真机观察。
- 字体栈优先 `Segoe UI Variable` 并回退系统无衬线；macOS 将落到系统字体。Windows 计算样式已验证正文/Composer 15px、导航/按钮 13–14px、元数据 11–12px，生产可见文字无低于 11px 项；macOS 的字面尺寸、字重、中文回退、缩放和 VoiceOver 仍为 `UNPROVEN`。
- 会话历史使用等宽 `18px × 3px` 短横杠并保留文字状态；会话动作仅在 hover 或 `focus-within` 显示。macOS 的键盘焦点环、触控板 hover 缺失场景和 VoiceOver 操作顺序须真机验证。
- Token 已从常驻仪表盘移到模型选择器旁的 usage ring/pill，并打开独立对话层；估算、Provider 实际、cache read/write/miss、会话累计与未知值分层显示。Windows 已观察 Escape 关闭与焦点回返，960×720 弹层无横向或纵向溢出；macOS 原生标题栏、交通灯安全区、Command 快捷键和辅助技术行为仍为 `UNPROVEN`。
- 品牌资产通过 `assets/branding` 清单和 renderer branding 入口预留。当前仅使用代码原生 V，占位状态为 `PENDING_IMAGE2_ASSET`；本机没有 OpenAI Key，最终 gpt-image-2 图标保持 `BLOCKED_LOCAL_OPENAI_KEY`，macOS 图标尺寸、模板图、Dock 与打包资源均未实现。
- CLI 的 TTY 强调色改为 cyan/teal，`--plain` 与 `--jsonl` 协议保持不带 ANSI。Windows 真运行不能证明 Terminal.app、iTerm2、不同 locale、TTY 宽度与 ANSI 支持；macOS CLI 继续为 `UNPROVEN`。
- 本阶段没有 macOS arm64/x64 构建、安装器、签名、公证、自动更新或真机窗口/终端证据；macOS 总状态继续保持 `UNPROVEN / 无 Mac 真机`。

## Phase 5 v0.8 DeepSeek 与 Agent 边界同步（2026-08-12）

- `AGENTS.md` 由独立 instructions 模块按每个 run 读取规范文件名，形成稳定快照并限制为 128 KiB；renderer 只读取状态投影，不直接访问文件。Node 文件源可跨平台复用，但 macOS 大小写、权限、符号链接与打包后 cwd 行为尚未真机验证。
- `PermissionPolicy` 是桌面与 CLI 共用的唯一工具授权状态机：只读工具在 auto 下可执行，状态变更和 ask 进入批准；CLI 没有交互批准时 fail-closed。macOS 的批准卡、VoiceOver、焦点与窗口生命周期仍为 `UNPROVEN`。
- DeepSeek 当前 V4 模型、每会话 `user_id`、协议工具名投射/反投射及专属 tool-result 形状只位于 OpenAI Chat/DeepSeek Provider 边界；核心 ToolRegistry 和其他 Provider 不受影响。Windows 已完成受预算约束的真实 flash 调用，macOS 代理、TLS、取消与真实 Provider 行为不能据此宣称通过。
- Windows 隔离数据根已观察 Electron `safeStorage` 保存后不回显，并在验收后通过正式服务删除测试密钥；这只证明 Windows DPAPI 链。macOS Keychain 的保存、读取、删除、重加密、锁屏和账户切换继续为 `UNPROVEN`。
- Windows 已观察 1440×900 与 960×720 原生窗口中的 DeepSeek V4、权限允许/拒绝、Token cache、双会话协作与 AGENTS.md 状态；窗口显示监听顺序缺陷已用回归修复。macOS `ready-to-show` 时序、标题栏、交通灯安全区和同尺寸布局仍须真机验证。
- Windows CLI 已真实验证 Demo/local fake、JSONL、Provider 凭据边界和取消；CLI 仍不复用桌面 safeStorage。macOS Terminal.app/iTerm2、TTY 信号、UTF-8 与退出码行为仍为 `UNPROVEN`。
- 本阶段没有 macOS arm64/x64 构建、安装器、签名、公证、自动更新或真机证据；macOS 总状态继续保持 `UNPROVEN / 无 Mac 真机`。

## 2026-08-13 ADR-0026 至 ADR-0067 目标同步

- 编程能力与 Windows 共用 ADR-0026 的 P1 搜索读取、P2 文件变更、P3 终端/构建测试、P4 Git/复核合同。macOS 适配只处理路径大小写、权限位、符号链接、默认 shell、Command Line Tools 和进程信号差异，不复制编程 Runtime；四阶段真机均为 `UNPROVEN`。
- 自适应工作区使用本机 Git worktree 和项目受管临时根。隔离任务目标在检查与适用审查满足条件后形成一个可读提交，shared 工作区无用户明确要求时不提交；成功合并且干净后回收大目录并保留七天恢复记录。需要验证 APFS 路径、大小写敏感卷、文件监听、Command Line Tools、任务分支、恢复重建与未合并成果保留；macOS 状态为 `UNPROVEN`。
- 会话固定模型和可选智能分配完全位于共享 core；启用智能分配后默认均衡并可按任务切换质量优先/均衡/轻量优先。macOS 只投影选择器、能力/缓存说明和运行锁定状态，不显示价格；代理、系统证书、真实 Provider 与缓存行为仍需 Mac 真机和单独真实调用授权。
- Skill、MCP 和可执行插件按 ADR-0029 分层，分发按 ADR-0036 开放公共市场、公开直链、自定义来源和本地包。macOS 可执行插件目标使用受管暂存、受管子进程、窄 IPC 和显式安装信任；Gatekeeper、隔离属性、包下载、Keychain 凭据转交和崩溃隔离均未验证，不得宣称公共市场或可执行插件已支持。
- 分层记忆按 ADR-0030 使用共享领域合同与本地结构化检索，按 ADR-0037 对长期未用或冲突条目标记“可能过时”、暂停自动注入但不自动删除。macOS 需要验证数据目录、文件权限、90 天定时评估、睡眠/时区、删除与 Keychain/秘密边界；当前实现仍为 `UNPROVEN`。
- 会话按 ADR-0038 永久留在主列表直至用户手动删除；macOS renderer 与 Windows 共用摘要索引、搜索/筛选和虚拟滚动，但触控板滚动、VoiceOver 大列表导航、删除确认及长期占用仍须真机验证。
- 本地存储目标按 ADR-0032 使用 SQLite 保存结构化状态、受管文件保存大型日志/产物/worktree，并由单一 Runtime 所有者写入；ADR-0039 不提供日常自动备份，只允许迁移/schema 重写使用本次操作的一次性回滚副本。macOS 必须验证数据库驱动与打包、APFS 落盘、异常退出、文件引用、旧 JSON/NDJSON 迁移和可恢复回滚；当前均为 `UNPROVEN`。
- 超长会话按 ADR-0040 在共享 core 中静默生成上下文摘要、保留原始历史并换代缓存身份；macOS 需要验证长会话内存、睡眠唤醒后的 generation、真实 Provider usage 和大列表性能，当前为 `UNPROVEN`。
- Token/缓存按 ADR-0041/0059 只统计、不提供 Harness 预算限制；macOS 只投影相同 usage 面板与取消入口，不能添加平台专属价格、金额或预算控件。用户自行到 Provider 查询价格与账单。
- 桌面与 CLI 的单一 Runtime 所有者目标使用当前用户范围 Unix domain socket、所有权租约和安全交接；按 ADR-0042，新所有者完成恢复检查后自动继续 run，并重放结果未知步骤。Keychain 是唯一共享秘密端口；桌面/CLI 同时连接、进程强退、Provider 部分流、工具重放、电脑完全访问失效、Terminal.app/iTerm2、睡眠唤醒和账户切换均保持 `UNPROVEN`，且不安装 LaunchAgent 或永久 daemon。
- 应用更新按 ADR-0043 目标为官方 Preview 渠道自动检查/下载并由用户确认安装重启。macOS 的 arm64/x64 包选择、签名、公证、下载暂存、活动 run 等待、安装失败回退和原生更新体验均未实现或真机验证，不得宣称已支持自动更新。
- 数据迁移按 ADR-0044 同时提供完整非秘密归档和会话/项目选择性导出；macOS 需要验证 APFS 大小写与权限、受管产物选择、跨 Windows/macOS manifest、导入暂存/预览/合并和 Keychain 秘密排除，当前均为 `UNPROVEN`。它不改变 ADR-0039 的无日常自动备份策略。
- 长期记忆按 ADR-0045 只做可调软容量提醒且不自动删除；macOS 需要以真实数据验证 SQLite 查询、正文体积统计、大列表与磁盘空间变化，初始阈值没有实施证据前不得伪造。
- 匿名诊断按 ADR-0046 默认关闭，用户主动开启后才上传字段白名单内的崩溃/性能数据；macOS 崩溃栈路径清理、payload 预览、官方端点、关闭后的队列停止均为 `UNPROVEN`。
- 扩展更新按 ADR-0047 对 Skill、MCP 和插件一律等待用户确认，能力变化还要重新信任；macOS 需要验证包暂存、Gatekeeper/隔离属性、旧版本保留和活动 run 快照，不能静默替换纯 Skill。
- Provider 网络按 ADR-0048 默认使用 macOS 系统代理与 Keychain 信任链，高级设置可按 profile 覆盖代理和自定义 CA，且不允许关闭 TLS 验证；SystemConfiguration、PAC、证书选择、CLI 共享和真实连通性均为 `UNPROVEN`。
- Gemini 按 ADR-0049 默认关闭服务端状态并使用本地历史；只有具体 profile 显式开启且端点能力已证明时才续接交互。macOS 不会因 Keychain、睡眠或跨端恢复自动开启，真实保留与删除能力保持 `UNPROVEN`。
- 本地数据按 ADR-0050 保持“每台设备、每个系统用户一个默认身份和数据根”，不加入 Viniper 账号、iCloud、局域网同步或远程 Runtime。普通数据只使用 ADR-0044 的手动非秘密归档，portable 秘密只使用 ADR-0057 的独立加密密钥包；Windows 与 macOS 互通、导入后独立演进均保持 `UNPROVEN`。
- 自动任务按 ADR-0051 保存 IANA 时区并使用共享 DST 语义；macOS 必须验证系统时区到 IANA、睡眠/唤醒、春季缺口、秋季重复时间、跨设备导入和未来三个触发点预览，不能用当前系统时区静默改写来源任务。真机状态为 `UNPROVEN`。
- 产物保留按 ADR-0052 区分正式成果/审计与可再生成产物；默认只清理登记满 30 天的可再生成内容，并允许 7/30/90 天或永不清理。APFS 权限、符号链接、大小写路径、空闲清理和不触碰用户项目文件尚未真机证明。
- 模型目录按 ADR-0053 在成功权威刷新后更新；失败保留旧目录，成功列表中消失的模型只退出未来选择，不改活动 run 和历史。系统代理、Keychain 凭据、睡眠唤醒后的 24 小时刷新和真实 Provider 列表均为 `UNPROVEN`。
- 完整工具输出按 ADR-0054 流式保存到受管文件，并只向模型投影有界片段；macOS 需验证大文件、二进制引用、秘密过滤、虚拟加载、受控续读、异常退出后的 `incomplete` 和磁盘不足行为，当前为 `UNPROVEN`。
- 通知按 ADR-0055 使用应用内权威事件与 macOS Notification Center 分级投递；系统通知默认开启、声音默认关闭，锁屏默认不显示敏感正文。授权拒绝、Focus 模式、点击回到对应任务、CLI Runtime 所有者和应用退出后无守护进程均须真机验证。
- 项目搜索按 ADR-0056/0066/0067 只对用户明确项目建立增量索引，并在索引过期或失败时退回项目内实时补查；词法/路径/符号保持基础能力，每项目可选完全本地语义索引。基础与语义索引低优先级运行，在 Agent、构建、本地推理或系统资源压力上升时降速/暂停并从检查点继续；FSEvents、大小写敏感卷、符号链接、忽略规则、Apple Silicon/Intel 本地嵌入、资源观察、睡眠唤醒和零项目外扫描均为 `UNPROVEN`。
- 秘密迁移按 ADR-0057 使用与普通归档分离的密码加密密钥包；Keychain 中 portable 分类、无明文中间文件、错误密码零写入、冲突默认保留本机和 Windows/macOS 互操作均须真机验证。
- 本地模型按 ADR-0058/0062–0065 保持云端默认主路径，同时允许已有兼容端点和用户从内置已知来源、本地文件或自定义来源取得受管模型；主包不带权重。更新只提醒并由用户确认下载/切换，工具能力明确分为原生/实验模拟/无工具，本地推理默认单路并由共享 Runtime 提供资源建议。Apple Silicon/Intel、受管复制、下载续传、版本并存、资源检测、回环监听、运行器签名/隔离、模型许可、实验工具模拟和多路推理全部为 `UNPROVEN`，云端失败不得自动切本地。
- 扩展按 ADR-0060 保留 current 与一个 previous；macOS 需验证包暂存、Gatekeeper/隔离属性、活动 run 额外引用、确认回退和插件数据兼容，不能把 current/previous 清理成交付成功。
- 本地日志按 ADR-0061 默认只保留无正文结构化事件，单次 run 详细诊断只记录开启后的状态/网络/队列信息并在 run 结束关闭；路径清理、崩溃前落盘、导出和零自动上传均为 `UNPROVEN`。
- 本节只同步目标草案，不改变“无 Mac 真机、无 arm64/x64 安装包、无签名/公证证据”的总状态。

## Phase 6 v0.9 P1 纵向闭环与交付顺序同步（2026-08-13）

- Windows 当前只交付 x64 便携包；macOS 在 Windows Preview 阶段验收和取得真机前只维护本草案，不产出 arm64/x64 包，不运行签名、公证或更新流程。
- P1 的项目根、目录发现、词法搜索、范围读取、工具结果续轮和历史/Token 持久化必须位于共享 core/features。macOS 平台层未来只适配原生目录选择器、大小写、权限位、符号链接与数据路径，不能复制一套编程 Runtime。
- Windows 项目边界验证不能证明 APFS、大小写敏感卷、符号链接和沙箱/隐私权限；这些消费者在 Mac 真机前继续为 `UNPROVEN`。
- DeepSeek 继续作为首个真实实用化 Provider，但 Windows 真实 TLS、代理、safeStorage 和工具续轮不能替代 macOS Keychain、系统代理、证书和网络取消证据。
- 本地模型按 ADR-0070 保留目标设计但不进入本阶段实现；不得为了 macOS 草案提前加入模型权重、运行器或本机守护进程。

## Phase 6 v0.9 P1 实施交接（2026-08-13）

- Windows 已实现显式项目会话、`project.list/search/read`、模型有界投影、单一 PermissionPolicy、正式 Provider continuation、恢复隔离和 Token 对账。领域合同与工具实现位于共享 TypeScript core/features；macOS 不应复制第二套项目 Runtime。
- macOS 原生入口未来应使用 `dialog.showOpenDialog` 的目录选择语义并保持普通/旧会话 fail-closed。只有用户明确选择项目后才能读取项目文件或 `AGENTS.md`；应用程序目录、启动 cwd 和 bundle resources 不得自动成为项目。
- Node 项目文件系统对相对路径、根外符号链接、`.git/**`、常见凭据 basename/私钥后缀、UTF-8/二进制/大小和范围做窄边界。Windows 测试通过不能证明 APFS 大小写卷、Finder alias、Unix 权限、符号链接链和隐私授权；Mac 真机前全部为 `UNPROVEN`。
- Windows x64 便携目录已从交付目录直接启动且不依赖仓库 cwd/node_modules；这不构成 macOS app bundle、arm64/x64、签名、公证、Gatekeeper、Keychain 或数据路径证据。macOS 本阶段仍不产包。
- DeepSeek V4 Flash 已在 Windows 正式产品链完成一次 search/read 工具闭环并冻结真实 usage。该结果不能外推到 macOS 的系统代理、TLS/证书、Keychain、网络取消、睡眠唤醒或进程所有权；macOS 真实 Provider 仍为 `UNPROVEN`。
- CLI 的 cwd/`--project` 只代表终端用户显式选择；未来 macOS Terminal.app/iTerm2 的 cwd、UTF-8、TTY/JSONL、信号和单写者租约仍须真机验证。
- P2 文件编辑、P3 shell/依赖/构建测试、P4 Git 产品能力、本地模型、安装器、签名、公证与更新均未实现；不得由 P1 读取能力推导。macOS 总状态保持 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 7 v0.10 P2–P4 完整编程闭环草案（2026-08-13）

- P2 的 `project.write/edit/move/delete/diff` 继续位于共享 TypeScript 领域与 application port。macOS 平台适配必须验证 APFS 默认与大小写敏感卷、Unix 权限位、符号链接链、原子 rename、Finder alias 以及恢复区语义；Windows 通过不能替代这些证据。
- P3 的共享合同为 `terminal.run/output`、受管完整输出、退出码、超时与取消。macOS 实现预定使用用户默认 shell 的明确非交互调用和进程组信号，验证 Terminal.app/iTerm2、zsh/bash、UTF-8、ANSI、Command Line Tools、SIGTERM/SIGKILL 及子进程树；不安装 LaunchAgent，不复制第二套终端 Runtime。
- P4 使用系统 Git 与原生 `git worktree`，共享层负责 workspace 状态机、权限、资源锁、单任务提交、显式合并和七天恢复。Mac 真机需覆盖 Command Line Tools 未安装、APFS 路径/大小写、文件监听、任务分支、合并冲突、工作树重建与恢复引用到期；任何未合并或不明确成果都不得自动删除。
- 项目完全访问与电脑完全访问仍由共享 PermissionPolicy 表达；macOS 电脑完全访问只持续到当前 Runtime 所有者退出，不能绕过系统隐私授权、管理员认证或 Keychain。批准卡、VoiceOver、键盘焦点和标题栏交互保持 `UNPROVEN`。
- 自动审查继续使用执行 run 的同一 Provider/profile/model/reasoning 快照和全新只读上下文，最多两轮且只报告不修复。macOS 只复用共享审查编排；系统代理、证书、Keychain、睡眠唤醒和真实 Provider 审查都需要新的独立证据。
- renderer 复用 Windows 的文件差异、终端终态、Git/worktree 与审查卡；需在交通灯安全区、Command 快捷键、触控板、系统字体、VoiceOver 和 1440×900/约 960×720 等效尺寸上真机观察。
- Phase 7 仍只交付 Windows x64 便携包。没有 macOS arm64/x64 app bundle、签名、公证、Gatekeeper、Keychain、真机 shell/Git 或真实 Provider 证据；macOS 总状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 7 ADR-0075 一体化工作台同步草案（2026-08-13）

- macOS 与 Windows 共用一体化工作台的信息架构、15–16px 正文、冷青视觉、无重叠 Token 组件、会话短横线节奏、中央 Agent 时间线和右侧当前 run 上下文，不复制第二套 renderer。
- macOS 不照搬 Windows 的最小化/最大化/关闭按钮。自定义顶栏必须为左上交通灯和安全拖拽区预留原生空间，并映射 Command 快捷键、全屏、菜单栏、VoiceOver 与触控板行为。
- 批准的 V 图标轮廓可复用，但 `.icns`、Retina 小尺寸、Dock、Finder、浅深色背景、签名和公证后的显示均须在 Mac 真机重新验收；Windows 图标通过不能外推。
- 当前没有 Mac 真机、app bundle、交通灯交互或 VoiceOver 证据，因此本节只同步设计，状态保持 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 7 Checkpoint 2 P3 实施同步（2026-08-13）

- Windows 已将共享 `terminal.run/output`、PermissionPolicy、callId、资源锁、Provider history、canonical event 与桌面/CLI 投影接入唯一 Runtime；macOS 后续复用这些领域合同，不复制第二套终端状态机。
- 当前平台实现明确为 `WindowsProcessHost`，使用 PowerShell 与 Windows 子进程树。macOS 仍需实现非交互 zsh/bash 与进程组终止，并验证 UTF-8、ANSI、SIGTERM/SIGKILL、Command Line Tools、APFS 路径/权限和符号链接；全部保持 `UNPROVEN`。
- 一体化工作台已在 Windows 1440×900/960×720 达到 Visual Ralph 93/PASS；这不能证明交通灯安全区、原生菜单、Command 快捷键、VoiceOver、Retina/Dock 图标或触控板行为。
- 没有 macOS arm64/x64 app bundle、签名、公证、Keychain、shell、CLI 或真窗证据；总状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 7 ADR-0076 托盘菜单同步草案（2026-08-13）

- macOS 将 Windows 的 Tray 信息结构映射为菜单栏状态项：依次展示“正在运行 / 未读 / 已固定 / 最近”，每组最多直显 3 个 Agent 任务，余项进入“更多”；底部使用“新建 Agent”“打开/隐藏 Viniper Harness”“完全退出 Viniper Harness”，不引入 Chat 模式。
- 菜单继续消费共享 canonical session/run snapshot，隐藏不停止运行，完全退出释放 Runtime 所有权；Mac 平台层不得复制第二套会话或未读状态。
- Windows 冷青 V 轮廓可作为方向，但菜单栏模板图、Retina 资产、浅深色自动切换、VoiceOver、Dock/菜单栏生命周期和退出行为必须在 Mac 真机重新实现并观察。
- 当前没有 Mac 真机、菜单栏状态项或原生菜单证据，本节状态为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 7 最终 Windows portable 验收后的 macOS 边界（2026-08-13）

- Windows x64 portable 已完成 P2/P3/P4、原生 Tray 模板与生命周期、packaged 本地 fake E2E、zip 新解压直接启动和 `93 / PASS` 真窗验收；这些结果只冻结共享 core、application port、renderer 信息架构和 Agent 菜单语义。
- macOS 不复用 Windows 的 Electron Tray、PowerShell 进程树、PE/ICO 或 win32 打包证据。后续必须实现并真机验证菜单栏状态项、template image、交通灯安全区、zsh/bash 进程组、APFS、Keychain、arm64/x64 app bundle、签名、公证和 Gatekeeper。
- Windows 的离线验收没有授权任何 macOS 构建或真实 Provider 请求；macOS 总状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 8 Windows 完整预览版与用户级安装同步草案（2026-08-13）

- Windows 新合同将结构化真源改为 SQLite、桌面与 CLI 改为单一 Runtime 所有者和本机 IPC。macOS 将复用 schema、事务、迁移、runId 并行、恢复 checkpoint 与 application port，但平台层必须改用当前用户范围 Unix domain socket、Keychain `PlatformCredentialVault`、APFS 安全落盘和文件锁；不得复制第二 Runtime。
- 同会话多 run、全局并发、记忆、压缩、项目索引、调度、扩展、Provider 目录、本地模型、迁移、诊断、通知、保留策略和更新中心均属于共享领域合同。macOS 需另行验证 FSEvents、Notification Center、系统代理/证书、睡眠唤醒、Gatekeeper、模型 runner、资源检测和菜单栏直接消费者。
- ADR-0077 只授权 Windows `%LOCALAPPDATA%` 用户级安装和桌面快捷方式，不授权 macOS app bundle。未来 Mac 仍需分别产出 arm64/x64、`.icns`、签名、公证、Gatekeeper、安装/升级/回退和 Dock/Finder/菜单栏真机证据。
- Windows 安装和本地 fake PASS 不能外推 macOS Keychain、Unix socket、APFS、zsh/Git、真实 Provider、本地推理、通知、更新或安装行为。当前总状态保持 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 8 UI-first 冷青绘图仪工作台同步草案（2026-08-13）

- macOS 草案复用 `Cyan Plotter Rail / 冷青绘图仪工作台` 的连续画布、冷青 token、等宽历史短横轨、V 形汇流、16px 正文基准和按需 Token 明细，不建立第二套视觉系统。
- 自定义标题栏必须为左上交通灯预留安全区，并与系统全屏、窗口拖拽、辅助功能和菜单栏行为兼容；Windows 顶部菜单和窗口按钮布局不能原样复制。
- 菜单栏图标使用 V 的单色 template 版本；Dock/应用图标、浅色/深色模式和 Retina 小尺寸需在 Mac 真机单独验证。Windows PNG/ICO、Tray 实际视觉和字体指标不能外推。
- macOS 系统字体、`NSVisualEffectView`、Keychain、菜单栏弹出和窄窗口自适应均只保留实现约束；当前没有构建、签名、公证、安装或真机截图，状态继续为 `draft-only / UNPROVEN`。

## Phase 8 v0.12 UI-first 前端重构同步（2026-08-13）

- Windows 已将桌面 renderer 收敛为 `Cyan Plotter Rail` 连续工作台：左会话短横轨、中 Agent 执行时间线、一体 Composer、右上下文栏、按需 Token dialog 和冷青 V 资产。macOS 应复用共享信息架构与语义，不复制第二套 renderer 或状态机。
- macOS 自定义顶栏必须为左上交通灯、原生拖拽区、全屏和 VoiceOver 保留安全空间；Windows 的菜单弹层、最小化/最大化/关闭按钮、Tray PNG 和 960px 隐藏侧栏策略不能直接当作 Mac 证据。
- `v-icon-harness.svg` 可作为方向和可审计品牌源；Dock/菜单栏 template image、`.icns` 多尺寸、Retina 对比度、浅深色系统外观、字体和辅助功能均需在 Mac 真机重新验证。
- macOS 当前没有构建、签名、公证、安装、菜单栏原生状态项或真窗截图；本轮状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 8 Checkpoint 2 Runtime 所有者与并行运行同步草案（2026-08-13）

- Windows CP2 已在共享 application port 上接入单一 Runtime owner、当前用户/明确 data root 的本机 IPC、revisioned snapshot 重连和租约交接；macOS 应改用当前用户范围 Unix domain socket，并以同一 data root 锁保证桌面/CLI 不出现双写窗口。当前没有 Mac IPC、交接或多客户端真机证据。
- `runId`、同会话多 run、全局并发 1–8、资源锁、目标取消、provider/tool/approval/workspace/review checkpoint 和未知步骤 `may_repeat` 属于共享领域合同。macOS 只复用这些状态与恢复回执，不复制第二 Runtime；睡眠唤醒、进程终止、文件锁竞争和恢复现场仍需真机验证。
- macOS 桌面与 CLI 后续应分别作为 host/client 适配，CLI 可在桌面未启动时成为无界面 owner；Terminal.app/iTerm2、zsh/bash、SIGTERM/SIGKILL、UTF-8、系统通知和 VoiceOver 的 run stack/取消入口均保持 `UNPROVEN`。
- 电脑完全访问授权在共享 PermissionPolicy 中只保留当前 Runtime/活动 run 的内存边界；macOS 重启或 owner 交接必须重新取得系统隐私授权，不能从 SQLite 或 IPC 恢复明文授权。当前没有 macOS Keychain、TCC 或真 Provider 证据。
- 总状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`；本轮不构建、签名、公证或打包 macOS 制品。

## Phase 8 Checkpoint 3 会话记忆与项目索引同步草案（2026-08-13）

- Windows CP3 新增的永久会话查询、固定/搜索筛选、三作用域记忆、不可变上下文摘要、显式项目索引、智能分配冻结和 checkpoint 恢复均属于共享领域与 application port；macOS 不复制第二套状态机或直接开 SQLite。
- macOS 桌面/CLI 仍应通过当前用户 Unix domain socket 连接单一 Runtime owner。记忆与摘要写入同一 SQLite schema，敏感正文不得入库；APFS 上的文件引用只保存受管相对路径，Keychain 只保存秘密引用。上下文压缩必须保留原始历史，Provider/model 切换与缓存语义继续在适配器边界处理。
- 增量索引未来优先使用 FSEvents，低资源时暂停并记录 revision/pending checkpoint；项目外、`.git`、构建输出、codex 残留和凭据/私钥文件继续拒绝进入索引。无本地语义能力时 UI/CLI 保持关闭而不是显示伪结果。
- macOS 的菜单栏、通知、VoiceOver、APFS 大小写与权限、睡眠唤醒、Unix 锁竞争、CLI 信号、Keychain、真实 Provider 和本地模型均未进行真机验证。本轮无 macOS 构建、签名、公证、安装或截图，状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 8 Checkpoint 4 调度、受管产物与通知同步草案（2026-08-13）

- Windows CP4 已把 once/interval/daily/weekly、IANA 时区、DST gap/fold、未来预览、离线 interval 合并补跑和 overlap pending 放在共享 scheduler 合同；macOS 应复用同一状态与历史，时区解析使用 Foundation/ICU，睡眠唤醒后由应用 Runtime 恢复而不是安装 LaunchAgent/系统服务。本轮未在 Mac 验证睡眠、时区数据库版本或系统唤醒时序。
- Windows 的完整工具输出由统一 artifact service 写入受管目录，SQLite 只保存相对引用、状态、大小和保留策略。macOS 需使用 APFS 临时文件 + 原子 rename、文件句柄/协调锁和磁盘不足诊断，范围续读必须保持 run ownership；完整输出、审计、记忆和正式成果不可被周期清理，只有 SQLite 登记的 regenerable 引用可按 7/30/90/never 处理。
- Windows 通知分类已区分应用内普通状态、完成/失败/批准等待/委派结果/自动任务结果，系统投递无正文、声音默认关闭且投递失败不改变 canonical 状态。macOS 计划映射到 Notification Center，并单独验证通知授权拒绝、Focus/锁屏、点击回到任务、声音偏好和 CLI owner 存活边界。
- macOS 仍无构建、签名、公证、安装、真窗、真实通知、受管文件或真实 Provider 证据；本轮状态保持 `draft-only / UNPROVEN / 无 Mac 真机`，不得把 Windows CP4 PASS 外推为 Mac PASS。

## Phase 8 Checkpoint 5 扩展生态同步草案（2026-08-13）

- macOS 复用共享 Skill metadata-first 合同：发现阶段只读包清单与元数据，只有会话显式启用并开始 run 才加载正文；本地包、公开直链、custom 来源和市场目录应通过同一受管 staging/manifest 检查，公共来源不等于信任。Windows 本轮只验证冻结 loopback fixture，macOS 的 Finder/沙盒路径和来源权限仍 `UNPROVEN`。
- MCP 未来使用当前用户 Unix domain socket/显式 endpoint；只有用户明确配置才连接。可执行插件继续由共享 ExtensionManager 管理安装、信任、工具启用、current/previous、确认更新/回退和活动 run 版本快照；macOS 子进程需最小环境、独立 Application Support 数据目录和窄 JSONL IPC，不得把 Keychain、权限库或 Provider secret 注入插件。
- Windows 子进程故障隔离、loopback fail-fast、未信任执行 0 和 CLI/桌面同源扩展投影属于共享语义；macOS 需要重新验证 Unix 进程终止、崩溃回收、Keychain/沙盒权限、MCP server 生命周期、VoiceOver、系统通知与菜单栏 Extension Center，不能把 Windows 通过外推为 Mac 通过。
- 本轮没有 macOS 构建、签名、公证、安装、真实 MCP、公开市场或真实 Provider 证据；macOS 状态保持 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 8 Checkpoint 6 模型目录、网络与本地模型同步草案（2026-08-13）

- macOS 复用共享 Provider catalog、成功目录快照、失败保留旧目录、已消失模型的未来选择边界和 `modelUnavailable` 重选状态；目录刷新应经用户级 Unix socket 的单一 Runtime owner，不能由 renderer/CLI 直读 SQLite。IANA 时区、睡眠唤醒后的 24 小时判断和网络不可用时的旧目录保留仍需 Mac 真机验证。
- 系统网络作为默认，profile 代理和自定义 CA 只保留 Keychain/受管引用；TLS 不提供关闭开关。macOS URLSession、系统代理、证书信任、日志脱敏和网络断开 fail-fast 均未真机证明。
- Gemini server-state 继续默认关闭；开启前必须展示当前 endpoint 的保存/保留/删除边界，关闭不伪造远端删除，本地历史仍是权威。macOS 只同步该语义，不外推真实 Gemini 端点行为。
- Provider retry 的最多 5 次、无语义输出才可重试、attempt/max 同源投影和本地推理全局并发 1 属于共享领域合同；macOS 的 URLSession 错误分类、后台挂起/恢复和取消时序仍 `UNPROVEN`。
- 本地模型仅接受用户已有的 loopback OpenAI-compatible endpoint 或受管 runner；云端默认、不附带权重、不自动下载/切换，版本与来源/许可/格式/兼容性 metadata 由用户确认后保留。macOS runner、Metal/CPU 能力、沙盒、模型目录和本地工具能力尚无真机证据。

本轮没有 macOS 构建、签名、公证、安装、真实 Provider、真实代理/CA、Gemini 端点或本地模型 runner 验证；状态继续为 `draft-only / UNPROVEN / 无 Mac 真机`。

## Phase 10 v0.14 DeepSeek Harness 能力组合同步草案（2026-08-14）

- macOS 复用共享 `CompositionPlan`、`FrozenRunContext`、typed lifecycle、steer/inject、workflow/subagent、Code Mode 工具 SDK 与窄 LSP 合同；这些仍只属于一个 Runtime owner 和一个 SQLite 真源，不能为 Mac 复制第二 Agent loop。
- Code Mode 的平台执行后端在 Mac 应使用受管 worker/子进程、Unix domain socket 与进程组取消；每个 SDK 子调用仍回到共享 PermissionPolicy/ToolRegistry。worker 不是 TCC 或 App Sandbox 的替代品，文件、网络、自动化和辅助功能权限必须按 macOS 真机重新验证。
- LSP provider 需要在 APFS、大小写敏感路径、符号链接、Xcode/Command Line Tools 和语言服务器缺失情况下验证；只公开 definition/references/implementation/hover，失败时回退共享项目索引并显示来源。
- 能力方案中心沿用冷青连续画布，但标题栏需保留交通灯安全区；V 图标的 Dock、菜单栏 template、Retina 和浅深色仍需 Mac 资产。当前无 app bundle、真窗、Keychain、TCC、Code Mode、LSP、签名或公证证据，整体保持 `draft-only / UNPROVEN`。

## Phase 8 Checkpoint 8 Windows 完整预览同步（2026-08-13）

- Windows CP8 已完成用户级 portable/安装目录、本地 fake E2E、同源 CLI/application port、safeStorage synthetic secret 生命周期与 Cyan Plotter Rail 真窗验收；macOS 只同步架构，不外推通过。
- macOS 未来使用用户级 Application Support 数据目录、Unix domain socket 单一 Runtime owner、Keychain 作为 Provider secret 唯一明文边界；桌面与 CLI 继续是同一 application port 的 client，不能直开 SQLite、文件或网络。
- 用户级安装应落在用户目录并由 LaunchServices/应用自身处理，不安装后台服务、LaunchAgent、计划任务或系统级注册表等价物；卸载只移除产品安装目录和本产品入口，不删除用户数据。当前没有 macOS 安装脚本或制品。
- macOS 需要单独验证 1440/960 真窗、菜单栏/托盘等价入口、通知与声音偏好、Keychain 保存→重启→删除、APFS 原子迁移、Unix socket 交接、CLI 信号和沙盒权限。未验证项保持 `draft-only / UNPROVEN`。
- 真实 Provider、本地模型推理、公开市场/更新源、签名/公证、arm64 与真机安装均为 `NOT_AUTHORIZED / UNPROVEN`。

## 品牌图标圆角 v2 同步草案（2026-08-14）

- 共享品牌清单升级为 `rounded-frame-v2`：小尺寸矢量外框圆角由 16 调整为 20，Windows 原生 512px 图标外框由 64px 调整为 96px；V 主体、冷青主色、电路节点和透明外缘保持不变。
- macOS 后续应从同一主资产派生 16–1024px AppIcon，并单独检查 Dock、Finder、菜单栏与 Retina 缩放下的圆角观感；菜单栏 template 图标不应直接复用彩色方形 AppIcon。
- 本轮只完成 Windows 资产与安装入口验证，没有 macOS 构建、AppIconSet、真机 Dock/Finder、签名或公证证据，macOS 仍为 `draft-only / UNPROVEN`。

## Phase 10 v0.15 Viniper 三栏工作台同步草案（2026-08-14）

- macOS 复用左会话、中 Agent、右侧按需变更/活动/协作抽屉的共享 renderer 与 application port；会话名称/路径、同宽内联重命名、稳定会话排序、常显会话操作、渐进能力中心、紧凑 Composer 和代码变化 presentation 不复制第二套状态机。
- 自定义标题栏需要为左上交通灯与原生拖拽/全屏区域留出安全区；Windows 的 V 图标位置、窗口控制按钮、Tray 与快捷方式不能直接外推。Dock/AppIconSet、菜单栏 template image、Retina 与 VoiceOver 需要 Mac 真机复核。
- 固定模型、智能质量/均衡/轻量路由与 fallback 理由属于共享 run snapshot；macOS 桌面和 CLI 仍经当前用户 Unix domain socket 连接单一 Runtime owner，Keychain 保存 Provider secret，renderer 不直读 SQLite 或明文凭据。
- 代码变化抽屉只消费 canonical activity/workspace/review 投影；Mac 的 APFS 大小写、FSEvents、Git/zsh、进程组取消、TCC、睡眠唤醒、Notification Center 和菜单栏入口需要独立验证。
- Windows 的 270/270、DeepSeek 8/8、打包真窗与本地后端 E2E 均不能外推 macOS。本轮没有 Mac 构建、真窗、真实 Provider、安装、签名、公证或 arm64/x64 制品，状态保持 `draft-only / UNPROVEN / 无 Mac 真机`。

## v0.18 DeepSeek 稳定前缀同步草案（2026-08-14）

- `ContextProfile/FrozenRunContext`、canonical 工具/Skill 顺序、自动记忆不重复注入和追加式 Provider history 都是共享领域语义；macOS 不复制缓存规划器或第二 Runtime。
- Mac 的 Keychain、Unix domain socket、APFS 与窗口壳不会改变 Provider 请求序列化；Provider/model、AGENTS.md、显式记忆、工具或 Skill 真实变更仍应开启新的缓存代际。
- DeepSeek V4 压缩阈值和 OpenAI Chat reasoning 回放属于共享适配器逻辑，但睡眠唤醒、网络重连、owner 交接及长会话内存压力需在 Mac 真机重新验证。
- 本轮 98.76%/99.47% 只证明 Windows 上的真实 DeepSeek Provider 链，不能外推 macOS。当前仍无 Mac 构建、真窗、Keychain、Terminal.app/iTerm2、签名、公证或 arm64/x64 制品，结论为 `UNPROVEN`。

## v0.19 Yuanpu Planar 工作台同步草案（2026-08-14）

- macOS 复用同一 renderer 的 Planar 编辑式视觉层、冷青语义 token、三栏 Agent 信息架构、按需 Token/改动抽屉和 `1179px` 紧凑布局；不复制第二套页面或运行状态。
- Windows 自定义标题栏、右侧窗口控制、Tray、ICO 与桌面快捷方式不能直接用于 Mac。Mac 必须给左上交通灯、拖拽区、全屏、菜单栏和 VoiceOver 保留原生安全空间。
- V 的 `rx=24` 矢量源可继续派生 AppIconSet，但 Dock、Finder、菜单栏 template image、Retina、浅深色与高对比模式必须在 Mac 真机重做视觉检查。
- 本轮没有 macOS 构建、真窗、Keychain、Terminal.app/iTerm2、Dock、签名、公证或 arm64/x64 制品；结论保持 `draft-only / UNPROVEN / 无 Mac 真机`。
