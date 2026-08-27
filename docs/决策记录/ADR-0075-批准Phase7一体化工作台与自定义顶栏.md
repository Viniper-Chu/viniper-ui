# ADR-0075：批准 Phase 7 一体化工作台与自定义顶栏

- 状态：Accepted
- 日期：2026-08-13
- 决策人：用户 / Viniper Harness 管理层
- 适用版本：`v0.0.1 Preview`

## 背景

用户指出现有桌面端 Token 区文字遮挡、整体模块割裂、按钮笨重、默认应用菜单缺少产品感，并要求参考 Codex、Claude Code 与 Viniper 的成熟桌面秩序重新设计。管理层使用用户提供的顶栏截图与当前 P2 真窗生成了工作台和 V 图标候选，用户于 2026-08-13 明确回复“按这版做”。

批准参考：

- 工作台：`D:\Agent\codex\工作输出\Phase7-P2-P4-Windows-Portable\VisualRedesign\workspace-reference-v1.png`
- V 图标：`D:\Agent\codex\工作输出\Phase7-P2-P4-Windows-Portable\VisualRedesign\v-icon-concept-v1.png`
- 用户顶栏参考：`C:\Users\13968\AppData\Local\Temp\codex-clipboard-d0b79ee1-64f4-4cc5-922b-0f7d453910d7.png`

## 决策

- Phase 7 最终桌面端采用一块连续画布：窄自定义顶栏、左侧会话栏、中央 Agent 时间线、右侧上下文栏和底部 Composer 在同一视觉系统中连续衔接，不再使用互相悬空的大卡片拼盘。
- Windows Electron 隐藏默认菜单栏和默认标题栏视觉，改为产品自有顶栏。左侧展示 V 标记、`Viniper Harness` 与“文件 / 编辑 / 视图 / 任务 / 帮助”；中央展示当前项目和任务；右侧保留搜索、通知、设置及最小化/最大化/关闭。菜单只调用现有 application 能力或明确标为未实现，不伪造功能。
- 自定义顶栏通过窄 preload/IPC 接入窗口控制；拖拽区和交互控件使用明确的 drag/no-drag 边界。最小化、最大化/还原、关闭、菜单、键盘焦点和可访问名称都必须有直接消费者验证。
- 大窗基准为约 `248px / 弹性主区 / 300px` 三栏。中央时间线是视觉主体；右栏只承载当前 run 的 Token、缓存、执行清单、工具、协作和权限摘要；低频设置使用 dialog、drawer 或 route。
- 字体以 `Segoe UI Variable`、`Segoe UI` 和中文系统无衬线回退。正文目标 15–16px，导航和常用按钮不低于 14px，元数据不低于 12px；不得通过缩小字体解决布局冲突。
- Token 使用单行可伸缩状态胶囊或等价紧凑组件，设定明确的最小宽度、行高、溢出和数字对齐。主界面只显示清楚的当前量与状态，缓存读写、估算/对账和完整明细进入可展开区域；任何窗口尺寸下都不得重叠、截字或盖住邻近控件。
- 颜色以冷青、玉青、薄荷青和深墨色为主，状态仍有文字/图标辅助，不依赖颜色。主页面靠细分隔线、层级和留白组织，阴影只用于 Composer、浮层与对话框；移除过大的主按钮和重复状态卡。
- 左侧永久会话历史以均匀短横线、状态点和单行摘要形成安静节奏；会话切换、协作、自动任务、Skills/插件、Provider 设置、编程差异、终端、Git/worktree、自动审查与权限模式都使用同一视觉语言。
- 批准的 V 图标是生产资产的造型真源。执行层应将其收敛为透明背景、清楚轮廓、适配小尺寸的应用图标，并生成仓库内可追溯的 SVG/PNG/Windows 图标尺寸；不使用动漫角色、其他产品标志或难辨识的复杂细节。
- 不接管用户鼠标键盘。视觉复现与截图使用应用自有启动参数、隔离数据根和程序化窗口截图；除非用户再次明确授权，不使用 computer-use。

## 验收

- 每轮主要视觉修改后，用真实构建、全新隔离数据根和真实 application snapshot 捕获截图，不以静态假 HTML 或硬编码 Demo 冒充。
- 1440×900 以批准工作台为结构参考，Visual Ralph verdict 必须包含 `score / verdict / category_match / differences / suggestions / reasoning`，最终分数不低于 90。
- 约 960×720 验证抽屉化、顶栏、时间线、Composer、Token、停止和设置入口，无横向溢出或文本遮挡；窄窗不要求逐像素复制大窗。
- 顶栏窗口控制、菜单入口、Token 不遮挡、会话历史节奏、每个功能模块、键盘焦点、ARIA 和 reduced-motion 均要有自动测试或真实窗口直接证据。
- 最终截图、verdict、复现说明和程序化采集脚本进入 Phase 7 正式证据目录；像素 diff 只能辅助定位，不能代替结构化视觉判断。

## 代价与边界

- 自定义标题栏增加窗口状态、拖拽、缩放和可访问性验证成本，但换来统一产品形象和更清楚的工作台层级。
- 参考 Codex、Claude Code 与 Viniper 只指信息架构与成熟度，不复制其商标、源码或逐像素外观。
- macOS 同步保留一体化工作台，但必须为交通灯安全区、Command 快捷键和 VoiceOver 单独适配；无 Mac 真机前保持 `UNPROVEN`。

