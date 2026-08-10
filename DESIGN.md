# Viniper 5.0.1 Claude Desktop 风格设计真源

状态：`APPROVED_REFERENCE / V17_PROTOCOL_REPAIR / RELEASE_AUTHORIZED_AFTER_ACCEPTANCE`

本文件是 Viniper 5.0.1 当前产品界面与 Chat/Agent 交互模式的唯一设计真源。用户已明确批准以所提供的 Claude Desktop 结构说明、当前打开的 Claude 真实窗口和补充截图为目标，旧版视觉方案不再具有约束力；仅在结构或交互已经一致时复用实现。功能契约、Viniper 原有图标与快捷方式继承规则继续保留。2026-08-08 的最新用户指令进一步要求：页面眉头与 Claude 一致、技能库归入“自定义与技能”、原“首页/代码”改为真正不同的 `Chat / Agent`、删除丑陋的鼠标悬浮动画，并补齐 Claude 式侧栏分隔控件与可工作的顶部全局导航。

## 1. Evidence Reviewed

### 权威参考，按冲突优先级排序

1. 当前本机 Claude Desktop 1.26832.0 的只读窗口捕获：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/reference-claude-live-home.png`，1218×807，日文浅色首页状态。
2. 用户提供并批准的结构说明：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/reference-claude-desktop-layout.md`，覆盖首页、输入区、模型菜单、账号菜单、设置页与视觉语气。
3. 同批开源语言资源：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/reference-claude-desktop-zh-CN.json` 与 `reference-claude-desktop-en-US.json`。简体中文文件用于术语和桌面壳文案，英文文件只用于核对语义，不直接成为用户可见文本。
4. 用户补充的深色紧凑代码工作区参考：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/supplement-codex-dark-reference.png`，714×554。它只补充代码态的密度、留白、底部 composer 和低噪声工具条，不覆盖 Claude Desktop 主基准。
5. 开源布局参考：
   - https://github.com/cdesktop-ai/cdesktop ：其公开说明明确采用会话侧栏、对话记录和按需右侧 plan/files/preview 面板的 Code 标签页布局。
   - https://github.com/javaht/claude-desktop-zh-cn ：仅用作简体中文桌面术语与可见字符串参考，不运行补丁、不修改用户的 Claude 安装。
6. 用户对当前 Windows 原生标题栏空隙的标注：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/user-markup-native-titlebar-gap.png`。红圈区域必须收敛为 Claude 式同一条应用顶栏，不能保留独立白色系统标题条再叠一条应用顶栏。
7. 用户补充的 Claude 侧栏分隔控件和顶部左侧导航参考：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/user-reference-sidebar-splitter-nav.png`。它是点击折叠/展开、`Ctrl+B` 与拖动调整宽度共用同一分隔控件的权威交互参考。
8. 用户补充的 Claude 完整顶部导航参考：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/user-reference-full-top-navigation.png`。左侧控件顺序固定为菜单、侧栏、搜索、后退、前进；右侧保留状态入口和 Windows 原生窗口按钮安全区。
9. 用户补充的 Claude Code 工作区参考：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/user-reference-agent-workspace.jpg`。它定义 Agent 模式而非 Chat 首页：项目/会话导航更紧凑，主区以项目路径和任务会话为中心，正文是持续工作记录，底部 composer 带代码工作流状态，但只保留 Viniper 已有的真实能力。
10. 用户补充的左下账号菜单参考：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/user-reference-account-hover-menu.png`。账号/环境行是唯一入口，hover、focus-within 或点击时菜单向上展开；设置必须位于菜单内，不再以并列齿轮按钮常驻。
11. 用户补充的 Claude/Viniper 顶栏密度对比：
   `.omx/artifacts/visual-ralph/claude-desktop-authoritative/user-reference-titlebar-density-comparison.png`。当前 Viniper 的 48px CSS 顶栏和相邻控件在 Windows 150% 缩放下明显过高；按同顶点像素中心线复测后的目标为 32px CSS 单行标题带，并同步收紧下方导航和 composer，而非只缩图标。
12. 用户本轮指出的七项实际 Preview 偏差：
   `.omx/artifacts/visual-ralph/claude-output-v8/reference/issue-01-sidebar-glow.png` 至 `issue-07-empty-strip.png`。它们分别锁定侧栏旧暖色阴影、分段导航顶距、顶栏路径、旧消息气泡、失效文件原生弹窗、缓存路径混入回答和空输入上方白带。
13. Claude Code 当前官方依据：
   - https://code.claude.com/docs/en/desktop ：Code 标签页、prompt 下方模型/权限、Normal/Verbose/Summary 输出模式以及文件路径打开行为。
   - https://claude.com/blog/claude-code-desktop-redesign ：重设计后的会话侧栏、流式响应、集成文件/终端和三种输出模式；同页官方视频缩略图保存在 `.omx/artifacts/visual-ralph/claude-output-v8/reference/official-output-thumbnail.jpg`。
   - https://github.com/cdesktop-ai/cdesktop/tree/main/packages/ui/src/components ：只作为公开实现的补充佐证；其 `ChatThinkingMessage`、`ChatToolSummary`、`ChatFileEntry` 与 `ChatBoxBase` 共同表明思考/工具/文件是扁平结构化行，只有 textarea 卡片带边框，底栏左右分组不占用输入文本区域。
14. Claude Code 交互暂停与思考显示的当前官方依据：
   - https://code.claude.com/docs/en/agent-sdk/user-input ：权限请求与 `AskUserQuestion` 都会暂停当前运行，宿主必须展示交互并把 `allow/deny` 或问题答案回传后才能继续；问题输入包含 `question/header/options/multiSelect`。
   - https://code.claude.com/docs/en/permission-modes ：默认、接受编辑、计划、自动与绕过权限的边界不同；只有 CLI 实际请求确认时才显示批准卡，不能按用户文本关键词预判。
   - https://code.claude.com/docs/en/desktop 与 https://code.claude.com/docs/en/model-config ：Normal 视图折叠工具过程，思考默认折叠；Summary 只保留最终回复和改动。Viniper 当前目标采用更克制的默认视图：运行时显示思考状态，完成后不保留思考正文。
   - 用户本轮提供的 Claude 浅色/深色问卷截图是行内问答卡的视觉权威参考；仅借鉴构图、密度、步骤与键盘语义，不复制 Claude 品牌资产。
15. Claude Code 多会话与侧栏管理的当前官方依据：
   - https://code.claude.com/docs/en/desktop ：Code 标签页支持在侧栏创建和切换多个并行 session，每个 session 独立保存上下文和变更；Desktop 新会话自动使用 Git worktree 隔离。
   - https://code.claude.com/docs/en/worktrees ：CLI 可在不同终端用 `claude --worktree` 启动隔离的并行会话；没有 worktree 时也可运行多个终端，但文件冲突由用户自行管理。
   - https://claude.com/blog/claude-code-desktop-redesign ：新版侧栏同时呈现 active/recent sessions，并用于在多个在途任务之间切换。
   - 用户补充的 Claude 会话行截图定义紧凑气泡图标、会话名、hover/focus 时出现的省略号和向下锚定菜单；Viniper 只实现已有数据链能真实承载的动作。
16. Claude Code v17 协议修复的当前官方依据：
   - https://code.claude.com/docs/en/statusline ：上下文窗口是 session 级真源；`context_window.current_usage` 只计 input、cache creation 与 cache read，压缩后到下一次用量出现前可为空，output token 不进入当前窗口比例。
   - https://code.claude.com/docs/en/agent-sdk/agent-loop ：自动压缩由 Claude Code 自身执行，并发出 `type=system, subtype=compact_boundary`；Viniper 只投影真实边界与真实用量，不另起摘要 Provider 请求或更换 Claude session ID。
   - https://code.claude.com/docs/en/agent-sdk/custom-tools ：MCP 图片结果是带原始 base64 `data` 与 `mimeType` 的结构化 image block；只渲染真实 block 或已验证的本地图片产物，不从普通文本猜测图片。
   - 2026-08-10 用户截图与现场只读审计：新会话不得投影旧会话权限卡；权限选择按 session 保存；交互回答提交并被 CLI 接收后从活跃 Dock 消失；公开版本品牌统一为 `Viniper`，启动动画只精修原 V 图标。

### 现有 Viniper 证据

- `codex/运行残留/cp4-standard-light.png`
- `codex/运行残留/cp4-standard-dark.png`
- `codex/运行残留/cp4-narrow-light.png`
- `codex/运行残留/cp4-narrow-dark.png`
- `static/index.html`、`static/style.css`、`static/app.js`
- `tests/test_ui_contracts.py`、`tests/test_session_ordering.py`

这些只定义当前功能与回归边界，不再定义外观。旧版的永久右侧空卡片、巨大圆角壳、厚重阴影、顶部大胶囊工具条和品牌块均不得作为新设计的视觉依据。

## 2. Design Intent

Viniper 是本地 agent shell 的安静桌面工作区。界面应让会话、正文与输入成为第一视觉层，控制项退到第二层，工具和产物只在有内容时出现。整体观感接近 Claude Desktop：温和、克制、可长时间阅读；代码工作态可以像补充参考那样更紧凑，但不能变成终端主题拼贴。

### 第一性原理

- Chat 的本质是“模型根据对话文本返回对话文本”，不具备工具、文件、工作目录、skills 或 Agent shell 能力。
- Agent 的本质是“由用户选择的 agent shell 在明确权限和工作目录中执行任务”，会产生思考、工具调用、工具结果、文件产物和最终回复。
- 当前产品只有一个 Claude Code Agent 运行模式；Agent 不是可被反复创建的实体。用户创建的是该模式下的会话，因此可见动作统一命名为 `新建会话`，不得显示 `新建 Agent` 或维护多个 Agent 实例列表。
- UI 状态必须由真实运行状态产生；隐藏按钮、改变文案、扫描回复关键词或追加 system prompt 都不能替代能力边界。
- 视觉相似服务于更清晰地表达真实状态，不能用静态占位、伪造进度或错误命名的截图冒充功能完成。

### 用户价值

- 打开即知道当前处于 `Chat` 还是 `Agent`，且二者的会话、composer 和能力边界不会混淆。
- Chat 与 Agent 是两套针对不同任务的工作表面，不是同一 DOM 构图仅切换欢迎文案或隐藏几个按钮：Chat 服务于连续对话，Agent 服务于带项目上下文的执行记录。
- 最常用的“新建会话、切换会话、输入、附件、发送/停止”在一眼范围内。
- 模型、权限、目录、窗口置顶、会话置顶仍然可用，但不抢正文层级。
- 浅色和深色都像同一款产品，不靠夸张卡片、发光或彩色描边制造层级。
- 所有文字为简体中文；模型 ID、文件路径、命令与品牌专名除外。

## 3. Constraints

- 保留 Agent 模式现有后端、API、会话、附件、斜杠命令、流式消息、权限确认、自动上下文生命周期、更新、自检、主题和桌面能力。新增 Chat 模式时必须是真正的无工具对话路径，不得只改标签或用提示词假装禁用工具。
- 保留并继续打包 `static/assets/viniper-icon.ico`、`viniper-icon.png` 和现有 Viniper 标志；欢迎区使用原图标，不生成 Claude 放射标或 Codex 像素宠物。
- 预览快捷方式继续克隆原正式快捷方式属性，只替换已批准的名称、目标、工作目录、描述与图标路径；不得创建新图标风格。
- 不复制 Claude、Codex 或开源项目的源码、商标和品牌资产；只参考布局、层级、交互语义和开源中文术语。
- 不使用 CDN、在线字体或运行时在线图标库。图标使用现有本地资源、字符符号或项目已具备的本地方案。
- 用户已明确授权在 v17 全部协议门、隔离候选、Preview、正式安装迁移与更新链验收通过后发布 GitHub 正式更新；授权不是跳过验收的许可。门未通过时不得 push/tag/Release，也不得覆盖正式 4.3.3、正式快捷方式、正式数据或公开更新源。
- 视觉重构不得触发真实 provider/chat/compress 调用。

## 4. Tradeoffs

- 精确复刻与产品身份冲突时，保留 Claude Desktop 的布局节奏，替换为 Viniper 图标、功能和简体中文文案。
- 参考中存在而 Viniper 没有的计费、计划、语音、下载、排程等能力不伪造；相同位置只承载现有真实功能，或保持留白。
- 旧 UI 的永久“工具/产物”右栏保留数据接口但不自动展开；默认 Normal 输出把工具与文件直接放进连续 transcript，避免重复面板挤压正文和 composer。
- Electron 窗口必须使用 Claude 式隐藏标题栏与原生 title bar overlay，把拖拽区、应用导航和系统最小化/最大化/关闭合成一条视觉顶栏；浅/深主题同步 overlay 颜色。不得因此重写桌面运行监督或图标链。
- 可保留稳定 DOM ID 和事件逻辑以降低功能回归，但 HTML 层级、CSS 和可见控件允许重建。
- Chat 与 Agent 会话不可混用：新会话在创建时冻结 `mode=chat|agent`，旧会话兼容默认为 `agent`；切换顶部分段只显示对应模式的会话。

## 5. Information Hierarchy

### 第一层：工作内容

- 当前会话正文或空会话欢迎区。
- 底部 composer：附件、输入、模型、权限、上下文状态、发送/停止。

### 第二层：导航与上下文

- 32px 的全局标题区：按顺序排列菜单、侧栏、搜索、后退、前进；中央永久留白，不显示当前会话名、项目路径或工作目录；右侧为真实状态入口与 Windows 原生窗口动作安全区。
- 左侧栏：`Chat / Agent` 分段切换、真实导航入口、当前模式的置顶/最近会话、底部账号/设置行。

### 第三层：低频和按需内容

- 目录、窗口置顶、更新、自检等次级动作。
- 工具调用与产物面板，仅在有内容或用户主动展开时占据右侧。
- 模型菜单、账号菜单、附件菜单和会话操作作为锚定浮层。
- 设置使用覆盖式双栏页面，不再使用卡片网格弹窗。

## 6. Visual System

### 色彩 token

浅色：

- `--canvas: #f7f7f5`
- `--sidebar: #f2f2f0`
- `--surface: #fffefa`
- `--surface-hover: #ebeae7`
- `--text: #302f2b`
- `--muted: #77746e`
- `--line: rgba(48, 47, 43, 0.12)`
- `--accent: #d97757`
- `--accent-strong: #c86647`

深色：

- `--canvas: #0d0d0d`
- `--sidebar: #141414`
- `--surface: #1b1b1b`
- `--surface-hover: #2a2a2a`
- `--text: #f0efeb`
- `--muted: #9a9892`
- `--line: rgba(255, 255, 255, 0.11)`
- `--accent: #dd7a59`

颜色数保持少。蓝色只用于真实信息/链接状态；橙色只用于主要动作、轻量品牌记忆和必要焦点，不给整块容器发光。

### 字体与排版

- 界面正文：系统无衬线字体栈，简体中文优先 `Microsoft YaHei UI`。
- 欢迎标题可用本地 serif 栈形成 Claude 式编辑感；对话正文仍以高可读无衬线为默认。
- 基准正文 14px，次要信息 12px，侧栏项 13–14px，欢迎标题 34–44px 响应式缩放。
- 正文行高 1.55–1.7；控件行高和图标框固定，避免中英文切换造成跳动。

### 间距、圆角与阴影

- 间距基线：4 / 8 / 12 / 16 / 24 / 32px。
- 行项目圆角 8px，输入框与面板 14–18px，完全圆形仅用于发送按钮和明确图标按钮。
- 常规区块主要靠留白与 1px 边界分层，不用层层卡片。
- 阴影仅用于 composer、菜单、对话框和悬浮上下文面板；静态侧栏和正文不使用厚重阴影。

### Claude 密度与按钮尺寸

- Windows 150% DPI 下仍以 CSS 像素建模，并用完整窗口物理像素复核。用户对比图中 Claude 与 Viniper 窗口同一顶部起点，Claude 原生按钮中心约在物理 y=71，当前 Viniper 约在 y=84；因此窗口级标题带从 48px 收敛为 32px CSS，并让 Electron `titleBarOverlay.height` 与 CSS 共用同一 token。
- 顶部五个导航按钮和右侧 Viniper 状态按钮：28×28px hit box、16px 线性图标、6px 左右间距、6–7px 圆角；不能继续使用 34×34px 控件塞进 32px 标题带。
- 普通侧栏导航、Chat/Agent 分段和单行会话：目标行高 30–32px，图标 16px，正文 13px；会话辅助信息仅在确有必要时显示，不能用永久双行把会话行撑到 46px。
- 小图标动作：24–28px hit box、14–16px 图标；菜单项和设置左栏项：32px 行高、16px 图标、13px 正文。关键发送/停止按钮可为 30–32px，但不能比 composer 工具行高。
- Chat composer 与 Agent composer 分别定标。Chat 保留对话输入的舒展感，默认 84–96px；Agent 采用代码工作区紧凑输入，默认 60–72px。两者只在多行输入时按内容增长，上限仍由现有滚动策略控制。
- 以上数值是组件 token，不得在各选择器散落第二套 34/36/46/48px 高度。hover、pressed、focus 不能改变边界框尺寸。

### 图标

- 主品牌只用原 Viniper 图标。
- 操作图标保持 16–18px 线性、同一描边密度；不得用一组不同风格 emoji 代替产品图标。
- 所有只图标按钮必须有简体中文 `aria-label` 与 tooltip。

## 7. Interaction Patterns

### Claude 式页面眉头

- 不保留独立白色 Windows 标题条、传统菜单栏和第二条应用顶栏的叠层。
- Electron 使用 `titleBarStyle: hidden` 与 `titleBarOverlay`（或当前 Electron 等价原生能力），系统窗口按钮仍由系统绘制。
- renderer 顶部使用统一的 32px 窗口级可拖拽区；按钮、输入、分段控件标记为 `no-drag`；右侧为系统按钮预留安全宽度。Electron `titleBarOverlay.height`、CSS 首行和所有顶层弹层锚点必须共用这一密度真源。
- 主题切换时同步 title bar overlay 背景与符号色。原 Viniper 图标仍出现在应用内和窗口/任务栏图标链中。

### 顶部全局导航

- 顶栏是窗口级单一首行，横跨侧栏、分隔线和主区；侧栏内容与竖向分隔线都从顶栏下方开始。侧栏下方直接进入 `Chat / Agent` 分段，不再增加占高的“会话/+”或品牌眉头。不得把五个导航按钮放进“侧栏右侧的 main topbar”，也不得形成两条顶栏。
- 左侧顺序固定为：`菜单`、`侧栏`、`搜索`、`后退`、`前进`。图标使用项目现有本地线性图标方案；不得生成或复制 Claude 的品牌图标。
- 五项操作使用同一套 16–18px 线性图标，不用 `☰`、`▣`、`⌕` 等字形混搭冒充产品图标；允许把无品牌含义的线性 SVG 作为本地静态 UI 标记，原 Viniper 品牌图标与快捷方式图标链不得替换。
- `菜单` 打开锚定应用菜单，承载当前已有的真实动作：新建聊天、Agent 模式的新建会话、自定义与技能、设置、主题/更新/诊断等已实现入口。选择后浮层关闭，Esc、外部点击和焦点回收符合统一菜单契约。
- `侧栏` 调用与分隔控件点击和 `Ctrl+B` 完全相同的 toggle command，不维护第二份可见状态。
- `搜索` 打开应用内搜索/命令面板，至少检索会话、本地技能和真实应用动作。重名技能显示来源或路径用于区分；无结果有明确简体中文状态。选择结果必须真实导航或执行对应动作。
- `后退/前进` 使用应用内位置历史，不调用浏览器网页历史。会话、Chat/Agent 模式、技能列表/详情、设置分区等持久位置可入栈；菜单和搜索浮层的开关本身不污染历史。
- 应用历史回放时不得再次 push 同一位置；从后退位置发起新导航必须清空 forward 分支。无可用历史时按钮具有真实 `disabled`/`aria-disabled` 状态。
- 持久位置彼此互斥：会话/模式主页必须关闭技能页和设置层；技能页必须关闭设置；设置必须关闭技能页。关闭或返回某个持久内容页后，`navigation.current` 必须与用户实际看见的位置一致，不能只把层隐藏而让历史停留在隐藏页。
- 五按钮全局顶栏中央永久留白，不显示会话标题、工作目录或内容页名称。Agent 的真实会话标题与工作目录只出现在其下方第二行 `workspace-mode-bar`：位于 `Chat / Agent` 分段右侧的同一工作表面横向槽位；Chat 隐藏该区域。
- Claude 参考右侧的品牌图形不照搬。该位置只允许使用原 Viniper 图标承载真实的状态/活动入口；若本轮没有可验证的状态面板，则保持留白，不放装饰性假按钮。

### 侧栏分隔控件

- 侧栏与主区之间只有一个 Claude 式窄分隔控件。内容区高度有贯穿的 1px 弱分隔线，局部握柄略强且保持克制；实际命中区可更宽，但不能形成粗重把手。
- 同一控件同时支持：单击折叠/展开、`Ctrl+B` 折叠/展开、按住拖动调整宽度。顶部侧栏按钮复用同一 toggle command。
- pointer down 后记录起点和初始宽度；移动超过小阈值才进入 resize。pointer up 未形成有效拖动才执行 click toggle；一次手势不得同时调整宽度并折叠。
- 拖动期间禁止文本选择并持续 clamp 到响应式 min/max；释放后保存最后展开宽度。折叠不丢失该宽度，重新展开后恢复并再次按当前窗口范围 clamp。
- tooltip 使用简体中文两行语义：`点击折叠/展开  Ctrl+B`、`拖动调整大小`，并随当前状态把动作描述回正。焦点、Enter/Space 和鼠标均能执行同一折叠命令。
- 窄窗侧栏仍采用覆盖抽屉语义；拖动调整宽度只在具备固定侧栏的视口启用，toggle/`Ctrl+B` 在所有视口继续有效。

### 应用壳与侧栏

- 左栏顶部是 `Chat / Agent` 分段控件。切换后只显示当前模式的会话、导航密度、正文构图与相应 composer，不把同一会话或同一空态换皮复用。
- `Chat` 只允许普通模型对话：无工具、无工作目录、无权限模式、无 Agent shell、无斜杠命令、无技能注入、无文件写入。当前版本先采用文本聊天；附件入口在 Chat 中隐藏，避免暗示文件工具能力。
- `Agent` 承载原 Viniper 全部 agent shell 能力：工作目录、权限、附件、斜杠命令、skills、工具/产物、停止和上下文状态。
- 真实入口映射：Chat 下为 `新建聊天`；Agent 下为 `新建会话`；Agent 下另有 `项目与目录`，全局有 `自定义与技能`。不得出现 `新建 Agent`，不得添加没有实现的排程、付费或语音入口。
- 会话列表按“置顶 / 最近”分组；会话置顶与窗口置顶继续使用不同位置、文案和状态。
- 每个会话行采用 Claude 式单行主内容：左侧 16px 对话图标，中间可截断会话名，右侧只在 hover、focus-within、active 或菜单打开时显示省略号；不在一行常驻重命名、置顶、删除三个图标。
- 省略号菜单向会话行下方/右侧安全锚定，当前阶段只显示可真实完成的 `置顶/取消置顶`、`标为未读/已读`、`重命名`、`删除`，以及诚实复用现有工作目录选择流程的 `添加到项目`。该名称只是工作目录映射入口，不创建 Project 实体；没有会话分组与迁移数据链时不显示 `移动到组`。
- 会话菜单支持 Esc/外部点击关闭、ArrowUp/ArrowDown 循环、Home/End、Enter/Space 和可见单键提示；删除运行中会话必须先停止或明确拒绝，不能遗留后台 CLI。
- Agent 允许多个不同 session 同时运行。运行、停止、SSE、interaction request、abort controller、完成/失败与未读状态都以 session id 为键；切换会话只切换可见上下文，不取消后台任务，也不把后台流写入当前会话 DOM。
- 每个 Agent session 还独立拥有 `permission_mode`、Claude session ID、context usage/compaction 状态、queue、pending interaction 与 renderer Dock 投影。新建/切换会话必须先清空当前可见 Dock，再只恢复目标 session 的 server-authoritative 状态；用户级 `AGENT.md`、技能库和运行时能力开关可以共享，但任何会话的选择、回答或用量不得回写另一个会话。
- 当前 Viniper 只承诺进程/流/会话隔离，不宣称自动 Git worktree 隔离。多个会话指向同一工作目录时与 CLI 多终端语义相同；本轮不自动建分支、worktree、项目或组。
- 侧栏底部为原 Viniper 图标、显示名与当前环境，整行可聚焦/点击并带展开指示。hover、focus-within 或点击后，账号菜单从该行上方向上展开；鼠标从触发器移动到菜单时不得因缝隙提前关闭，键盘可用 Enter/Space 打开、Esc 关闭并把焦点还给触发器。
- 设置只能作为账号菜单内的第一项进入，不再保留并列的常驻齿轮按钮。菜单只呈现真实能力：`设置`、`检查更新`、`运行诊断/查看详情` 等现有可执行入口；没有账号体系、语言切换、付费升级、扩展商店或登出语义时，对应 Claude 项必须删除，不能放不可用占位。
- hover 只改变菜单显隐和行背景，不缩放、不位移、不发光；菜单向上锚定、使用低阴影和 1px 边框，并避免越过窗口左右边缘。

### 自定义与技能

- 点击 `自定义与技能` 打开主工作区内的独立全页技能库：其上缘紧贴 `workspace-mode-bar`，左右边界只占 sidebar/resizer 右侧的工作区；打开时会话正文、composer 与 interaction dock 必须隐藏且不可点击，返回后恢复同一会话与滚动位置。它不再打开 skills.sh，也不在侧栏底部保留独立技能星标入口。
- 技能库复用 `/api/skills` 与 `/api/skills/{id}`：包含分类、搜索、技能列表、说明详情和“用于 Agent”。1280×800 采用列表/详情双栏，900×700 可顺序切换，但字体与控件密度不随窗口缩小。
- Claude Code 个人/项目技能只发现官方顶层布局 `<root>/<skill-name>/SKILL.md`；不得把任意深层仓库副本通过 `rglob` 扁平化成假技能。`/command` 永远取目录 slug（包括其中的 `_`），frontmatter `name` 是原始展示名，缺失时才回退到首个 H1。
- `id/path/source/slug/command/name/description` 保持原始真值；简体中文只写入 `display_name/display_description/display_category`。维护过的条目显示准确中文，未知英文条目使用“本地技能 · 原始标题”和包含 `/command` 的诚实中文说明，不猜测功能语义；搜索同时覆盖中文展示字段、原始标题与命令。
- Viniper 通过 Claude Code 官方 `--add-dir <managed-root>` 暴露 `<managed-root>/.claude/skills/*/SKILL.md`。受管桥只建立指向原始技能目录的 WSL symlink，原目录仍是真源；不得覆盖 `~/.claude/skills` 中用户已有同名技能，冲突必须 fail-closed 并显示真实的“Claude Code 可用 / 仅 Viniper 可用 / 同名冲突”状态。启动或更新 Claude Code 后刷新该桥，重复同步幂等。
- 技能只属于 Agent。Chat 中访问技能库可以浏览，但“使用”必须明确切换到 Agent 并把命令注入 Agent composer；不得把 skill 注入 Chat。
- 不下载、不安装、不改写技能内容；受管桥只提供可回滚的官方发现入口，UI 可见不得冒充 CLI 可调用。

### 主区与消息

- Chat 空会话使用居中欢迎区：原 Viniper 图标 + `今天想聊什么？` + 简短建议；不得出现旧版“准备好了”大卡片。Agent 空态遵循下方独立工作表面契约，不复用 Chat 欢迎语或快捷胶囊。
- 有消息后欢迎区消失，正文列宽 720–820px，工具、思考、正文和文件产物通过类型标题、留白和浅边界区分。
- `#chat-container` 是会话正文唯一滚动容器。原生滚动条保持约 10 CSS px 命中区、约 6 CSS px 细 thumb；用户可直接拖动。流式输出只在当前 session 已接近底部时自动跟随，用户主动上翻后不抢回，回到底部才恢复；不同 session 的跟随状态互不覆盖。
- 左侧会话区提供可显示/隐藏的持久历史搜索，匹配标题与工作目录。结果仍来自 `/api/sessions` / `state.sessionIndex`，点击只重开既有 session，不复制会话、不重置其运行、权限、上下文或滚动状态。

### 思考与执行过程

- Chat 等待模型时，在当前 assistant turn 内显示一行 Claude 式轻状态：`正在思考…` 与真实经过时间；不显示旧版中央全局 spinner 或大块常驻 thinking 卡片。
- Chat 完成后保留最终回复与一行紧凑 `已思考 X 秒` 摘要；运行中的 `正在思考…` 与原始 thinking block 必须在最终文本出现或 turn 完成时移除，不提供完成后的思考 disclosure，也不把思考正文写入新的持久化会话数据。耗时只累计真实 thinking 区间，工具执行或普通等待不计入。
- Agent 使用 Claude Code 式时间顺序活动流：思考状态、工具开始、工具结果、文件产物、最终回复彼此分段。活动项默认紧凑，详细命令/输出可展开。
- Agent 的思考同样是瞬时运行态：流式期间可显示单行 `正在思考…` 与真实经过时间；最终文本开始输出或运行结束后删除思考正文，只保留紧凑 `已思考 X 秒` 摘要、最终回复、必要工具摘要、工具结果状态与文件产物。后端用 monotonic 时钟累计每段真实 thinking 区间并持久化 `thinking_elapsed_seconds`；工具间隔不计入，A/B 并行分别累计。旧会话中的历史 thinking 数据只做非破坏性隐藏，不批量改写用户会话文件。
- Agent 的 `tool_start/tool_result` 必须来自服务端结构化 SSE 与持久化 segment；不得通过扫描 `[Claude Code 工具]`、`运行`、`命令` 等可伪造文本推断。
- 最终回复与思考/工具活动严格分离。复制正文不混入隐藏 thinking、工具标记或计时标签。
- loading、elapsed、completed、failed、cancelled 必须由真实事件驱动；断线恢复后仍能从持久化 segment 重建同一顺序。

### 行内问答与权限确认

- `AskUserQuestion` 和权限确认都属于当前 Agent turn 的暂停状态，必须作为 transcript 内的 Claude 式交互卡显示在触发位置；不得弹 Windows 原生对话框，也不得使用脱离消息流的全局 modal。
- 触发真源只能是 Claude Code/Agent CLI 的结构化交互请求。删除发送前按提示词、路径或动作关键词猜测权限的旧逻辑；用户写“删除、运行、打开文件”等普通文本不能自行制造批准窗口。
- 服务端为每个活动运行维护唯一 pending interaction，以 `session_id + request_id` 关联请求与回答。前端提交只能命中当前会话、当前请求且尚未回答的交互；重复、过期、串会话或停止后的回答必须明确拒绝，不能落到另一个 CLI 进程。
- `AskUserQuestion` 卡片显示问题、简短 header、`当前题 / 总题数`、编号选项和说明；支持单选、多选、其他文本、上一步/下一步/提交/跳过（仅当上游允许）。方向键、数字键、Enter、Esc 与鼠标执行同一状态机。
- 权限卡片显示真实工具名、操作摘要、目标路径/命令与工作目录；至少提供 `拒绝` 与 `仅本次允许`。只有 CLI 请求明确携带可持久化的权限建议且后端能原样回传时，才显示 `以后允许`；前端不得自行写 Claude 配置或把一次允许升级成整轮 `bypassPermissions`。
- 权限模式由 session 真源保存，Desktop 顺序固定为 `Manual / Accept edits / Plan / Bypass permissions / Auto`，简体中文分别为“手动 / 自动接受编辑 / 计划 / 跳过权限 / 自动”。稳定持久值仍为 `default`，当前 CLI 暴露 `manual` 时仅在启动参数边界做 alias 映射。`bypassPermissions` 只有设置显式允许并且 CLI 的 allow/permission 参数真实生效时出现；`auto` 只有当前账号、模型、Provider 和 CLI 均真实支持且设置启用时出现，DeepSeek/第三方 Provider 默认 fail-closed；CLI-only `dontAsk` 永不进入 Desktop 选择器。现有 session 的选择彼此独立；非 Plan 选择按 workdir 记忆为后续新 session 初值，Plan 只作用于当前 session，均不覆盖已存在会话。
- 是否弹窗由 CLI 决定；自动允许或绕过模式没有真实请求时不得显示假卡。等待期间保持同一条流式连接与停止能力，composer 的新发送被禁用；用户提交成功后活跃卡立即退出可交互 Dock，内部保留 awaiting-ACK 状态；matching CLI ACK 成功后只留下紧凑历史结果，ACK 失败时才恢复不可操作的失败记录。
- 点击停止必须终止对应 CLI、使 pending interaction 失效并把卡片标为已取消。应用刷新或后端重启导致进程不可恢复时，卡片显示已失效并允许重新发送任务，不能伪装继续执行。

### Composer

- 位于主区底部、水平居中，最大宽度约 820–880px；宽屏不贴边，窄屏保留 12–16px 外边距。
- composer、附件上下文行和输入区 footer 必须与当前对话列（`#messages` / 欢迎内容）共用同一水平中轴。中轴由当下主工作区几何实时决定，不能相对整个窗口居中，也不能保留旧侧栏宽度对应的 `margin-right`、`translate` 或 `calc()` 补偿；侧栏默认、拖窄、拖宽、折叠后都必须自动回正。
- 按需工作区 rail 隐藏时，对话列等于主工作区可用内容区；rail 出现时，composer 与消息共同以 rail 左侧的对话列为布局容器，不能一个以全主区为轴、另一个以对话列为轴。
- 大圆角外框内：文本区居上；下排左侧为附件/添加，右侧依次为模型、权限、上下文轻状态、发送/停止。
- 空文本时发送为弱化状态；可发送时为圆形陶土橙主按钮。运行中同一位置替换为停止按钮，避免布局跳动。
- 上下文圆圈只读，hover/focus 显示一行短提示，不展开摘要正文。
- 圆圈只投影当前 session 的真实当前窗口 usage。解析优先接受 `context_window.current_usage`，并兼容当前 Claude Code transcript 的 `assistant.message.usage`；两者统一按 input + cache creation + cache read 计算 used，output 只作输出统计、不进入圆圈。重复 frame 按同一真值替换/去重，不累计；无真实值时显示不可用。收到真实 `system/compact_boundary` 后，transcript 与 composer 同时显示克制的“正在压缩上下文”，下一次真实 usage 到达后结束并刷新圆圈；不得由 renderer 在固定百分比调用外部摘要服务、切换 Claude session ID 或触发外部摘要。
- Chat composer 只保留模型、纯文本输入和发送/停止；占位文案为“输入消息”。
- Agent composer 才显示附件、权限、上下文、斜杠命令提示和工作目录相关状态；占位文案为“输入任务，或使用 / 命令”。

### 菜单与浮层

- 模型选择改为锚定弹层，以现有模型列表为数据真源；当前模型有勾选和简短状态，不伪造 Pro、升级或不存在的模型。
- 权限模式使用相邻独立弹层，不混同“思考强度”。
- 浮层白/深色实面、12px 圆角、细边界和轻阴影；支持 Esc 关闭、外部点击关闭、键盘方向键和焦点回收。

### 悬浮与动效

- 删除所有 hover 缩放、位移、旋转、弹跳、发光和阴影膨胀。鼠标移入只允许背景色、文字色、边框色和低幅 opacity 变化。
- 普通 hover 状态不使用 `transform`，不启动关键帧动画，不改变控件几何尺寸。
- 可保留功能性 loading spinner、流式光标和窗口打开/关闭的克制淡入；它们必须遵守 `prefers-reduced-motion`。
- 冷启动允许原 Viniper V 图标做一次 900–1450ms 的轻微景深/呼吸与高光收敛，不旋转、不弹跳、不改变图标轮廓；主窗口出现后动画立即结束。`prefers-reduced-motion` 下只保留短淡入，普通按钮 hover 仍禁止动画。
- 过渡时间建议 80–140ms，只应用于 `background-color`、`border-color`、`color`、`opacity`。

### 设置

- `Ctrl+,` 和账号菜单打开近全屏覆盖层，背景带克制 scrim。
- 左侧是搜索与分组导航；只列出现有真实设置：个人、外观、Agent、模型与服务、桌面应用、目录和诊断等。
- 右侧是单列设置表单，标签在左、控件在右或下一行；不得再使用多张等权卡片网格。
- 保存/取消固定在可见底部，关闭按钮固定右上。

## 8. Responsive Behavior

- `>= 1180px`：侧栏 260–292px；正文居中；有真实内容时右侧上下文面板最大 320px，空面板不显示。
- `820–1179px`：侧栏 232–252px；上下文面板默认收起为按钮或覆盖层；composer 最大宽度随主区缩放。
- `< 820px`：侧栏变成覆盖抽屉；标题区只保留侧栏开关、标题和必要动作；模型/权限/目录进入 composer 的紧凑行或更多菜单。
- `< 620px`：欢迎标题缩小；快捷建议允许换行；设置页左导航变成单列列表或顶部选择器。
- 缩放与主题切换不得改变结构语义。标准验收使用 1218×807；紧凑验收使用 714×554；另保留当前 1300×900 基线以检查 Windows Electron 壳。
- 响应式规则只能收窄 composer 的可用宽度和外边距，不得通过固定左右偏移改变它与正文的中轴关系。

## 9. Component Rules

- `AppShell`：只负责标题区、侧栏、主区和按需上下文区布局。
- `ModeTabs`：Chat/Agent 模式与会话过滤；模式属于会话数据，不是临时视觉状态。
- `SessionNavigation`：新建、项目、自定义、置顶/最近会话；继续使用现有 session API。
- `SessionRunRegistry`：renderer 只按 session id 保存可重放的运行状态、结构化事件、segment 与 event cursor；不保存 DOM 节点、reader 或 abort controller。后台 SSE 始终先进入对应会话状态，切回时从当前 DOM 重建，绝不继续写入被替换的节点。
- `SessionTransportRegistry`：按 session id 保存浏览器侧 reader、abort controller、计时器和同一请求的重试上下文；停止 A 只终止 A 的 transport，不能影响 B。服务端 `_active_runs` 与 session lock 仍是实际进程真源。
- `ClaudeCrossSessionAdapter`：只接受当前结构化 CLI 明确暴露的 `ListAgents` 与 `SendMessage`；`_active_runs` 仅把目标限制为 Viniper 自己的重叠活动会话，发送前仍由 Claude 原生 `ListAgents` 确认地址。`claude agents --json` 只属于 Agent View 生命周期，不是 peer registry，也不能开启跨会话入口。
- `NativePeerMessaging`：按 sender session 与 tool id 配对原生 `SendMessage` 事件；只有明确的 delivered/success 才显示已送达，held/refused/failed 分别呈现，未知结果失败关闭。普通文本、文件、数据库或服务端复制都不是跨会话传输。
- `SessionContextMenu`：复用会话更新/删除 API 完成置顶、已读状态、重命名与删除；不拥有项目/分组/worktree 业务。
- `ConversationView`：空态与消息态二选一，不套外层大卡片。
- `Composer`：保留现有输入、附件、斜杠建议、上下文、发送/停止事件接口。
- `ContextRail`：复用工具/产物数据接口；空时折叠，有内容时展开。
- `AnchoredMenu`：模型、权限、账号、添加菜单共享焦点与关闭行为，不共享业务数据。
- `SettingsOverlay`：导航与表单分离；现有设置字段和保存 API 是唯一数据真源。
- `AccountMenu`：侧栏底部向上锚定的 hover/focus/click 菜单；只路由到现有设置、更新和诊断动作，不拥有虚构账号、付费、语言、扩展商店或登出能力。
- `SkillsLibrary`：本地 skill 分类、搜索、详情和 Agent 注入；不拥有安装或远端下载能力。
- `NativeTitlebarBridge`：负责 title bar overlay 主题同步、拖拽区和系统窗口按钮安全区，不拥有会话、窗口置顶或业务状态。
- `GlobalNavigation`：统一菜单、搜索、位置历史和后退/前进；导航回放使用 suppress-push 边界，浮层开关不入历史。
- `SidebarSplitter`：统一 click、drag、`Ctrl+B` 和顶栏侧栏按钮，持久化最后展开宽度；不得存在并行的第二套 sidebar 状态。
- `ChatTransport`：直接调用当前配置的兼容 messages API，只发送用户/助手文本上下文，不提供 tools，不启动 Agent CLI，不读取工作目录。
- `AgentTransport`：继续使用现有 Claude Code/Custom CLI 适配链和全部既有权限/附件/工具语义。
- `AgentInteractionBroker`：只负责把 CLI 的结构化 `can_use_tool/AskUserQuestion` 请求规范化为当前 session 的 pending interaction，并把一次性用户决定写回同一 CLI stdin；不拥有 UI、权限猜测或配置写入。
- `InlineInteractionCard`：只渲染和提交当前 pending interaction，复用 transcript、焦点和键盘语义；不自行决定是否需要权限，也不直接调用文件系统或 CLI。

## 10. Page-Level Guidance

### Chat 空态与会话态

- Claude 真实截图是构图主参考：左侧栏稳定，右侧主区大面积留白，欢迎标题在视觉中心偏上，composer 位于下半部。
- 使用 Viniper 原图标，不复刻 Claude 放射图案。
- 欢迎标题使用“今天想聊什么？”，明确“只进行对话，不会调用工具或操作文件”。
- Chat 不显示目录、权限、附件、skills、工具/产物 rail 或 Agent 快捷建议。
- Chat 沿用 Claude Desktop 首页构图：欢迎区与对话列居中、留白更大、composer 为聊天型输入；不得出现项目路径、代码执行状态或工作流标签。
- Chat 顶部导航只承载全局导航和窗口级动作；无论空态还是正在对话，都不得显示当前聊天名称、消息数量或其它会话摘要。

### Agent 会话态

- Agent 以用户补充的 Claude Code 工作区截图为主参考，深色截图补充紧凑密度。它必须在结构上区别于 Chat：Chat 首页欢迎语不得作为 Agent 会话主构图；五按钮全局顶栏中央保持留白，真实会话标题/工作目录显示在第二行 `workspace-mode-bar` 的 Agent 横向槽位，正文不得重复；正文是消息、思考、工具和产物的连续执行记录，底部 composer 更紧凑并贴近工作流状态。
- Agent 侧栏以 `新建会话`、`项目与目录`、`自定义与技能`、置顶/最近 Agent 会话为核心；不复制 Viniper 不具备的计划任务、Cowork、More、升级或远端协作入口。
- Agent 主区可按需显示工作区 rail，但空 rail 必须消失；存在工具/产物时正文与 composer 共同以 rail 左侧对话列为中轴。第二行 Agent 横向槽位的目录上下文必须来自真实 session/workdir，不使用截图中的示例项目名；标题与路径是相邻字段，不拼成正文中的重复标题。
- Agent composer 保留现有真实模型、权限、附件、上下文、Slash 技能/命令、发送/停止；可把已有权限状态表达为截图中类似 `Accept edits` 的轻量工作流标签，但不得新增未实现的自动接受或计划任务开关。
- Agent composer 必须分成两层：上层有边框的任务输入框只容纳 textarea 与发送/停止；模型、权限、上下文和添加/附件全部位于输入框边界下方的独立无框工具行。工具行左侧优先权限、添加/附件和上下文，模型放在右侧；不得再把这些控件挤进输入框内部。
- Chat 保持独立聊天 composer：只显示模型、文本与发送/停止，且不得因为 Agent 工具行重构而泄露权限、上下文、附件或 Slash 控件。
- 技能/Slash 建议作为 composer 上方的锚定列表，支持键盘筛选与选择；内容来自本地技能真源，不复制截图中不存在于本机的条目。
- 当前模型、权限、目录和工作区状态放在标题区或 composer 次级行，不形成旧版大胶囊工具条。
- 工具与产物区空时必须消失；出现时与正文同高或覆盖，不创建两张永久空卡。
- Agent 空态不复用 Chat 的欢迎标题或快捷胶囊；运行时就绪时显示真实本机用量面板（无账本则显示诚实空态），运行时未就绪时显示真实安装/诊断状态。出现 transcript 后只保留按顺序渲染的消息、思考、工具与产物。

### 对话、思考与工具输出

- 顶部标题带与其下方内容面使用同一画布背景，不使用水平分隔线、阴影或伪元素制造接缝；Windows 原生标题按钮安全区仍保留。
- 助手消息直接渲染 Markdown 正文，不显示模型名、头像、彩色角色标题或可见的总耗时；系统摘要可以保留明确的系统标签。
- 当前思考显示为单行扁平的静音文本：16px 对话点图标、简体中文状态和可选的克制计时。最终文本出现或 turn 完成后原始思考正文完全消失，只保留一行按真实 thinking 区间累计的 `已思考 X 秒`；无完成后 `思考过程` disclosure、卡片边框、黄色强调、呼吸动画或几何变化。
- 结构化 `tool_start` 与匹配的 `tool_result` 必须合并为同一条工具摘要；不得把开始和结果渲染成两条彩色时间线。摘要使用 16px 工具图标、一个极小状态点和静音文本，运行中状态可以仅让状态点克制脉冲。
- 工具输出优先进入既有 workspace rail 或可展开详情，不在正文中复制为第二张结果卡。产物也使用单条紧凑文件摘要；所有条目仍由结构化事件驱动，不从普通文本关键词推断工具活动。
- Chat 用户消息沿用 Claude Desktop 的右侧聊天气泡；Agent 用户任务采用 Claude Code 式左对齐、最大约 75% 宽度、左下角收窄的轻量气泡。最终助手输出在两种模式中都保持无外框的正文列。

### 自定义与技能态

- 作为 `workspace-mode-bar` 下方、sidebar/resizer 右侧的工作区内容页，不作为侧栏底部小浮窗或居中窄卡；打开时会话层 inert，返回时恢复原 session/messages/scroll。
- 标题、搜索、分类、列表和详情层级清楚；1280×800 双栏，900×700 时列表与详情可顺序切换且不整体缩放。
- “用于 Agent”是唯一主动作；在 Chat 来源进入时先明确切换 Agent。

### 设置态

- 以参考说明的双栏覆盖结构为主；导航项必须映射现有真实字段。
- 表单视觉统一，敏感字段保持密码输入和现有保存语义。

## 11. Accessibility

- 所有交互元素可通过键盘到达；明显焦点环与主题对比度一致。
- 分段控件、会话列表、菜单、对话框、状态和日志使用正确 role/aria 属性。
- 仅图标按钮有简体中文名称；禁用状态既有视觉变化也有 `disabled`/`aria-disabled`。
- 减少动态效果偏好时关闭启动缩放、菜单位移和非必要过渡。
- 触控目标建议不小于 36×36px；文本与背景对比符合 WCAG AA 的常用正文要求。

## 12. Input / Output Contracts

### 输入契约

- `/api/status`、`/api/settings`、`/api/sessions`、单会话、chat/cancel、filesystem、skills、diagnostics、update、desktop shortcut 等现有接口。
- Agent SSE 新增结构化 `interaction_request` 事件，至少包含 `session_id`、不可猜测的一次性 `request_id`、`kind`、安全展示字段和可用动作；不得把完整 CLI 内部对象或敏感配置直接交给 renderer。
- 新增一次性 interaction response endpoint，服务端校验当前活动 session/request/kind 后将 `allow/deny/answers` 回传同一 CLI stdin；成功、重复、过期、已取消和串会话使用可区分状态。
- 会话对象新增稳定 `mode: "chat" | "agent"`；旧数据缺省读取为 `agent`。
- Agent 会话对象新增稳定 `permission_mode`；旧数据只在迁移当下复制用户级默认值，之后所有选择、切换、reload 与 resume 都按 session 读写。
- Agent SSE 接受并投影 `system/compact_boundary`、真实 `context_window.current_usage` 与结构化 `image` segment。图片 segment 仅允许受支持 MIME、受限体积的 base64 block 或服务端验证过的本地附件 URL；无效图片退化为安全文本/文件行。
- chat endpoint 请求携带并校验会话 mode；服务端根据持久化 mode 选择 ChatTransport 或 AgentTransport，不信任前端单独声明来改变已有会话类型。
- 现有 Electron preload 能力、主题、窗口置顶与快捷方式构建配置。
- 原 `static/app.js` 中稳定 DOM 事件和数据状态，可封装但不得静默丢失。

### 输出契约

- 用户可见文本全部简体中文。
- 用户可以完成现有全部主路径，且会话置顶和窗口置顶仍严格分离。
- 左侧会话行只常驻名称和运行/未读状态，省略号菜单真实完成置顶、标为未读/已读、重命名和删除；不存在的数据能力不显示。
- 至少两个 Agent session 可同时保持活动 CLI/SSE；切换、停止、回答权限/问题和完成通知均不串 session。自动 Git worktree 隔离保持未实现且不伪装。
- Agent 模式只创建会话，不创建 Agent 实例；UI、搜索命令、菜单和空态中均不出现 `新建 Agent`。
- 顶部菜单、搜索、侧栏、后退和前进都执行真实动作；分隔控件的 click/drag/`Ctrl+B` 共用同一状态源且重启后恢复宽度。
- Chat 实测不会启动 Agent CLI、不会出现权限确认、不会读取/写入工作目录、不会注入 skill 或斜杠命令；Agent 仍保留这些能力。
- 原 Viniper 图标贯穿窗口、启动、应用内品牌和预览快捷方式。
- 空工具/产物不占空间；有内容时仍可观察并操作。
- Windows 原生按钮与 renderer 顶栏在浅/深主题下形成同一条 Claude 式眉头，不存在用户标注的白色空隙。
- 五按钮顶部全局导航不出现正在进行的对话名称、项目路径或工作目录，中央永久留白；Agent 会话名和工作目录只允许出现在第二行 `workspace-mode-bar` 的分段右侧槽位，Chat 隐藏该槽位，正文不重复。
- 思考、工具调用、工具结果、产物与最终回答按结构化事件顺序形成一条 Claude 式连续消息流；匹配的工具开始/结果只占一个摘要行。
- Agent 的真实问答与权限请求在消息流内暂停并可交互，回答后继续同一运行；一次允许不能升级整轮权限。任务完成后只保留最终输出和必要工具/文件结果，不保留思考正文。
- 新建空会话的 Dock 必为空；A 会话延迟到达的 interaction/ACK/compact/image 事件只更新 A registry，切到 B 时不得写 B DOM。回答成功后的活跃卡不常驻；只有紧凑历史结果或失败关闭状态可留在 transcript。
- 正式产品、安装器、窗口标题、开始菜单和公开 Release 的显示名统一为 `Viniper`；为兼容既有自动更新与用户数据，可保留经过迁移测试的内部 app ID/数据目录标识，不通过改 ID 制造第二套正式安装。

## 13. Validation and Regression Targets

### 视觉循环

每轮在 `.omx/artifacts/visual-ralph/claude-desktop-authoritative/iterations/` 记录：

- 目标状态与准确窗口尺寸；
- 实际 Electron 截图；
- `visual-verdict.json`，至少包含 `score`、`threshold`、`pass`、`summary`、`differences[]`；
- 主要差异与下一轮修复。

视觉通过阈值为 `score >= 90`。像素差分只能作为辅助，因为品牌、中文内容和数据不同；最终以结构、比例、层级、留白、交互状态和原图标正确性为判定主体。

### 必验状态

- 1218×807 浅色 Chat 空态，对照 Claude 真实截图。
- 714×554 深色 Agent 空态或轻会话态，对照用户补充截图。
- 标准浅色 Agent 项目会话态，对照 `user-reference-agent-workspace.jpg`，确认它与 Chat 首页在顶部上下文、正文构图、侧栏内容和 composer 控件上均明显不同。
- 左下账号/环境行 hover、focus、点击和 Esc：菜单向上展开，设置在菜单内，鼠标可进入菜单，所有可见项目均能执行；无能力项目完全不出现。
- 150% DPI 顶栏密度：Electron overlay、CSS 首行和弹层 top anchor 使用同一 32px token；顶部按钮 28×28px、图标 16px，物理截图与 `user-reference-titlebar-density-comparison.png` 的中心线一致，误差不超过 3 物理像素。
- 1300×900 浅色/深色 Agent 会话态，检查 Windows Electron 壳、消息、composer 和按需上下文区。
- 标准浅/深色 title bar overlay，必须实际 PrintWindow 观察系统按钮与 renderer 顶栏连成一体。
- Chat 和 Agent 各在有消息状态实测顶部标题：当前会话名不出现在顶栏；顶栏与下方内容之间无边框、阴影或一像素色差线。
- 合成结构化 Agent transcript 覆盖 `thinking -> tool_start -> tool_result -> artifact -> text`：流式阶段有思考状态，首个最终文本或 `done` 后思考正文/状态消失；工具开始与结果合并为一行，产物为紧凑摘要，最终文本为无卡正文。
- 合成双向 CLI fixture 覆盖 `AskUserQuestion` 单选、多选、其他输入和权限 `allow/deny`：每次先停在 transcript 行内卡片，键盘/鼠标回答后同一进程继续并产生最终回复；重复、过期、串会话和停止后的响应被拒绝。
- 双会话串卡红测：A 等待 Bash 权限→新建或切到 B→注入延迟 A interaction/ACK；B Dock 始终为空，A 权限/上下文/运行状态不变，切回 A 才恢复其真源。
- 交互终态红测：提交成功即从活跃 Dock 收起；matching ACK 成功保持消失并生成一条紧凑记录，ACK 失败恢复不可操作失败记录；重复 ACK 幂等。
- 权限模式回归：默认/接受编辑/计划仅在 fixture 真正发出控制请求时显示卡片；自动/绕过且没有控制请求时不显示任何假权限窗口。
- 权限持久化回归：A=`plan`、B=`default`，切换、reload、resume 后仍各自保持；Auto 对 DeepSeek/第三方 Provider fail-closed；bypass 同时验证设置门、会话状态与实际 CLI 参数；`dontAsk` 不在 Desktop DOM。
- 原生压缩红测：真实 `current_usage`→`system/compact_boundary`→下一次 usage，逐 session 验证圆环和“正在压缩”；全链不得调用旧自动 `/api/compress`、不得更换 Claude session ID、不得触发摘要 Provider。
- 图片块红测：assistant image、MCP tool_result image 与本地图片 artifact 可预览；无效 MIME/base64、超限数据和普通文本路径不能生成图片 DOM。
- Claude 式顶部五项导航：菜单打开并执行动作、搜索检索并跳转会话/技能/命令、后退/前进跨会话和技能详情正确回放。
- Claude 式侧栏分隔控件：点击折叠/展开、`Ctrl+B`、拖动改宽、tooltip、键盘焦点与重启宽度恢复。
- composer 中轴回归：Chat/Agent 各自覆盖侧栏默认、拖窄、拖宽、折叠四态；工作区 rail 隐藏时 `composer` 与 `messages` 的中心差不超过 2 CSS px，且完整窗口截图中与欢迎/正文列同轴。
- Chat 会话和 Agent 会话各自新建、切换、重启恢复、列表过滤；旧会话默认 Agent。
- 会话行菜单：hover/focus/点击打开省略号菜单；置顶、未读、重命名、删除及键盘导航全部作用于锚定 session，菜单切换时不误操作当前会话。
- 双 Agent synthetic 并行：A 等待权限/问题时 B 继续流式输出；切换到 B 不取消 A；停止 A 不影响 B；B 在后台完成后会话行显示未读/完成状态，切回后只显示 B 的内容并清除其未读。
- Chat 假 provider 测试确认请求 body 无 tools 且不启动 CLI；Agent 原回归全绿。
- `自定义与技能` 的搜索、分类、详情、返回和“用于 Agent”。
- 窄窗侧栏抽屉、设置覆盖层、模型菜单、权限菜单、附件菜单、会话菜单。
- hover 无缩放/位移/发光；另验 focus、pressed、disabled、loading、streaming、error。

### 功能回归

- 保留并更新现有静态 UI 契约测试，不用旧 CSS 类名机械锁定新设计。
- `python -m unittest discover -s tests -v`
- `python scripts/verify_slash_suggestions.py`
- `python scripts/verify_provider_routing.py`
- `python scripts/verify_desktop.py`
- `python scripts/verify_app.py`
- `node --check static/app.js desktop/main.js desktop/preload.js`
- 实际 Electron 冷启动；不调用真实 provider。

### 对抗性验证

- 直接构造 Chat HTTP 请求携带 `permission_mode`、attachments、guidance、斜杠命令、skill 命令或假 `interaction_mode=agent`，服务端仍按持久化 session mode 拒绝/忽略越界字段，且不启动子进程。
- Chat 文本包含 `/goal`、`请运行命令`、绝对文件路径、`[Claude Code 工具]` 或 `[工具结果/完成]` 时，只作为普通文本送入模型，不触发权限、工具 rail、文件打开或 Agent 路由。
- Agent 普通回复中出现“工具、执行、命令、读取、写入、运行”等词时，不得伪造工具事件；只有结构化 tool event 能展开活动项和 rail。
- 伪造前端 mode 不能改变已存在会话的 mode；旧会话缺 mode 时稳定迁移为 Agent，不批量破坏原数据。
- Chat/Agent 快速切换、重复发送、停止、断线恢复和重启后，不串会话、不串模式、不把 Chat 消息发送给 Agent CLI。
- title bar 拖拽区不能吞掉 Chat/Agent 分段、窗口按钮、输入和侧栏操作；浅/深主题切换不能产生白色标题条。
- 2px 内轻微移动仍按 click toggle，超过阈值的 drag 只调整宽度而不折叠；拖动不选择正文，折叠后重新展开恢复最后宽度。
- `Ctrl+B`、顶栏侧栏按钮和分隔控件点击连续交替操作不得状态分叉；composer 聚焦时快捷键仍执行侧栏命令。
- 从 Chat 会话进入 Agent 会话、再进入技能详情后，后退/前进顺序正确；后退后新导航清空 forward，历史回放不递归增殖。
- 菜单和搜索支持 Esc/外部点击关闭与焦点回收；零结果、重复技能名和 Chat/Agent 会话结果均不串模式，浮层开关不污染导航历史。
- hover 状态逐项检查布局几何不变；截图前后控件边界不能因 hover 发生缩放、位移或发光膨胀。

### 交付边界

- 只有真实 Electron、原图标、原快捷方式继承链、浅/深/紧凑视图、五条 v17 协议红测和主路径共同通过时，才能更新隔离 Preview。
- 用户已明确批准本批在上述门、正式安装迁移、回滚、GitHub 资产与 `latest.json` 更新链全部通过后公开发布；任何未证明项都必须停在 Preview 或候选，不能把公开授权解释成强推。
