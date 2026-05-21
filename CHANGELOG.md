## v2.1.1 (2026-05-22)

### 修复
- **切换会话时主进程弹错**：修复 Electron 主进程在打包环境中继续向已断开的 stdout/stderr 管道写日志导致的 `EPIPE: broken pipe, write`。现在 server 日志会通过安全写入函数输出，遇到断管会停止写控制台，不再弹出 JavaScript error。

### 验证
- `node --check desktop/main.js`
- `npm run check`
- `python scripts/verify_app.py`
- 使用 Node `Writable` 模拟 `EPIPE` 断管，确认安全日志函数不会抛出未捕获异常。

## v2.1.0 (2026-05-21)

### 修复
- **模型/API 层卡住的根因处理**：Viniper UI 现在区分“正在等待本地工具返回”和“正在等待模型/API 响应”。本次卡住的证据显示，Claude Code 已经拿到工具结果，随后进程仍保持网络连接但 JSONL 不再增长，属于模型/API 请求无响应，而不是本地任务还在执行。
- **同会话自动恢复**：当底层 Claude Code 在模型/API 阶段连续无输出时，Viniper UI 会停止挂住的子进程，并用同一个 Claude Code session 自动恢复一次，要求它检查已完成文件后继续，避免直接放弃任务。
- **长任务显示修复**：补上 `thinking_delta` 流式解析，长推理或长工具链运行时会继续把思考/进度写入 UI，不再因为只收到流式思考而看起来像“无输出”。
- **大文件任务稳定性**：追加系统约束，遇到 docx/pdf/图片很多或长日志时优先生成文件，只在聊天里返回摘要和路径，减少第三方模型网关在大工具结果后失联的概率。
- **模型回退**：Pro 模型执行 `claude -p` 时携带 Flash 作为 fallback model，遇到明确过载时可由 Claude Code 自动回退。

### 验证
- 复盘卡住任务 JSONL：最后停在 docx 图片清单工具结果后，确认不是本地工具执行中，而是模型/API 下一跳无响应。
- 使用模拟 Claude Code 子进程复现“工具结果后模型阶段无输出”，确认 Viniper UI 会自动恢复同一个会话并继续收到最终结果。
- `python -m py_compile server.py`
- `node --check static/app.js`
- `python scripts/verify_app.py`

## v2.0.5 (2026-05-21)

### 修复
- **任务中途无响应**：当底层 Claude Code 连续 20 分钟没有任何 stdout 输出时，Viniper UI 会判定为无输出失联，自动停止该任务并恢复输入框，避免模型请求或外部工具挂住后界面无限等待。
- **长任务保护**：该保护只看“连续无输出时间”，不限制任务总时长；只要 Claude Code 持续输出工具结果、思考过程或文本，长任务仍可继续运行。

### 验证
- 手动复现并停止卡住的 `高考前模拟卷（不含概率）` 任务，确认会话恢复输入且无残留 `claude.exe`。
- `python -m py_compile server.py`
- `python scripts/verify_app.py`

## v2.0.4 (2026-05-21)

### 修复
- **根治 stdout 行长限制**：不再依赖 Python `StreamReader.readline()` 和它的 `limit` 参数读取 Claude Code `stream-json`。Viniper UI 现在按字节块读取 stdout，再自行按换行切分事件，因此不会再因为单条 JSON 行超过 32 MB 或其他固定读取上限而报 `Separator is found, but chunk is longer than limit`。
- **长任务兼容性**：长工具结果、超长初始化事件、大量 skills 列表和长上下文流式输出会继续被读取；界面展示仍按现有规则截断工具输出，避免 UI 被巨量文本拖垮。
- **目录选择**：新建会话和切换工作目录不再只能手动输入路径；现在可以浏览磁盘文件夹、进入子文件夹、返回上一级、直接使用当前目录，也可以在设置里的默认新建位置下快速新建文件夹。

### 验证
- `python -m py_compile server.py`
- `python scripts/verify_app.py`
- 使用 40 MB 单行模拟 Claude Code stdout，确认可完整读取并按行解析，不触发 Python readline 限制。
- 验证 `/api/filesystem/roots`、`/api/filesystem/children`、`/api/filesystem/folders`，以及目录选择弹窗能把路径写回新建会话/切换目录输入框。

## v2.0.3 (2026-05-20)

### 修复
- **Claude Code 启动失败**：修复 `stream-json` 单行输出超过 Python 默认读取上限时出现的 `Separator is found, but chunk is longer than limit`。Viniper UI 现在把 Claude Code 子进程 stdout/stderr 读取上限提高到 32 MB，避免长工具结果、超长 system init 或大量 skills 列表导致界面误报启动失败。
- **错误提示**：如果未来仍有极端单条输出超过上限，会显示明确的流式输出读取错误，并停止本次任务，不再误报为 Claude Code 安装或启动问题。

### 验证
- `python -m py_compile server.py`
- `python scripts/verify_app.py`
- 使用已有历史会话触发 Claude Code 启动，确认不再出现 `chunk is longer than limit`。

## v2.0.2 (2026-05-20)

### 修复
- **断显但任务仍在跑**：流式输出期间会把助手草稿和工具过程持续写入会话；如果 UI 连接中断，会停止底层 Claude Code 进程，避免任务在后台继续幽灵运行。
- **重复任务残留**：启动同一会话的新任务前，会清理该会话遗留的 Claude Code 进程，避免同一会话同时跑多个 `claude.exe`。
- **权限确认**：`需要时确认` 模式会在请求明显涉及本地文件、命令、程序、桌面、附件等操作时弹出确认框；按 Enter 允许本次操作，按 Esc 取消。确认后只对本次请求使用 `bypassPermissions`。

### 验证
- `node --check static/app.js`
- `python -m py_compile server.py`
- `python scripts/verify_app.py`
- 验证权限弹窗 Enter 允许、Esc 取消，且允许后本次请求真实传入 `bypassPermissions`。
- 验证同一会话残留 `claude.exe` 会在新任务前被清理，断开流时不会继续后台执行。

## v2.0.1 (2026-05-20)

### 修复
- **发消息报错**：当历史会话保存的 Claude Code 底层会话 ID 已失效时，不再直接报 `No conversation found with session ID`，会自动重建底层 Claude Code 会话并重试当前消息一次。
- **历史保护**：重试前只回滚本次刚追加的用户消息，不清空历史对话、不删除附件和本地设置。

### 验证
- `node --check static/app.js`
- `python -m py_compile server.py`
- `python scripts/verify_app.py`
- 使用已损坏的历史会话触发发送，确认 UI 能自动恢复并继续回复。

## v2.0.0 (2026-05-20)

### 修复
- **模型切换**：顶部模型选择会写回后端设置，刷新或重启后仍以用户选择的模型作为主模型，避免环境变量把界面选择覆盖回旧模型。
- **目录按钮**：目录弹窗保存失败时会明确提示，并只在后端保存成功后更新当前会话目录。
- **任务收尾**：Claude Code 错误、超时、启动失败、被拦截命令等路径都会发送 `done` 事件，避免前端误以为任务仍在运行。

### 界面
- **圆润化**：整体圆角提高到更柔和的层级，按钮、输入框、卡片、弹窗和会话项更接近现代桌面/iOS 触感。
- **布局延续**：保留技能库上移、设置移到左下角、主题颜色集中到设置面板的布局。

### 验证
- `node --check static/app.js`
- `python -m py_compile server.py`
- 浏览器自动化验证模型、权限、目录、设置、技能库入口均可点击并生效。
- 真实 Claude Code 流式 smoke test 返回 `done`，输入状态可恢复。

## v1.1.0 (2026-05-20)

### 修复
- **模型选择器偶发无响应**：移除 `saveSettings` 中重复的 `renderModelSelect()` 调用，消除连续两次 innerHTML 重建导致的交互中断。同时移除 `renderCurrentSession` 中强制同步 select.value 的逻辑。
- **权限选择器点击无效**：从 `change` 事件处理器中移除 `renderPermissionSelect()` 调用，避免事件期间 DOM 被销毁导致焦点丢失。
- **目录按钮无效**：`changeWorkdir` 不再使用原生 `window.prompt`，改为网页内 modal 弹窗。

### UI 重构
- **布局调整**：技能库移至侧边栏顶部，设置移至侧边栏底部，主题切换并入设置面板。
- **iOS 风格设计**：毛玻璃侧边栏与顶栏（`backdrop-filter`）、圆角卡片、微阴影立体感、平滑过渡动画。
- **暗色主题优化**：accent 色切换为橙黄暖色系，更配合深色背景。
- **按钮交互增强**：hover 时微上浮 + 阴影加深（`translateY(-1px)`），点击时下沉回弹。

## v1.0.2 (2026-05-20)

### 修复
- **快捷方式目标**：源代码目录自检或开发启动时，也会优先把桌面和开始菜单快捷方式指向已安装的软件入口 `D:\Viniper UI\Viniper UI.exe`，避免再次退回 `start.bat` 网页入口。
- **更新清单**：桌面构建后会把 Windows 安装包写入 `latest.json` 的 `assets.windows`，低版本可收到完整桌面安装包更新。

### 验证
- `python scripts/verify_app.py`
- `python scripts/verify_release.py`
- `python scripts/build_desktop.py --target win --skip-install`
- 本机桌面和开始菜单快捷方式目标校验为 `D:\Viniper UI\Viniper UI.exe`。

## v1.0.1 (2026-05-20)

### 修复
- **版本收敛**：统一源码、桌面壳、更新包和本机安装版版本号，修复源码为 `0.2.8`、运行版为 `1.0.0` 的不一致。
- **桌面入口**：复核并保留“创建桌面快捷方式”按钮，快捷方式统一指向软件版 `D:\Viniper UI\Viniper UI.exe`，不再指向网页启动脚本。
- **发布保留策略**：GitHub Release、本地 `dist/` 和桌面构建产物默认只保留最新两个版本，后续每次发版会删除更早版本。
- **目录收敛**：最终维护目录固定为 `D:\Viniper UI\source`，`D:\Claude code` 清空，避免后续维护时改错目录。

### 验证
- `python scripts/verify_app.py`
- `python scripts/build_release.py --version 1.0.1 --repo Viniper-Chu/viniper-ui`
- `python scripts/verify_release.py`
- `python scripts/build_desktop.py --target win --skip-install`
- 本机安装版 `D:\Viniper UI\Viniper UI.exe` 启动后 `/api/status` 返回 `version=1.0.1`。

## v1.0.0 (2026-05-20)

### 重大更新
- 首个正式稳定版，完成从网页薄外壳到桌面软件壳的收敛。
- 保持薄外壳原则：Viniper UI 只负责界面、会话、附件、设置、更新、桌面壳；真正的 agent 执行仍交给 Claude Code CLI。
- FastAPI 启动流程改为 lifespan，兼容新版 FastAPI。
- 移除硬编码个人工作目录，改用安装目录、会话目录和用户选择目录。
- DeepSeek V4 Pro 上下文窗口配置提升到 1,000,000 token。
- 统一版本号、AppUserModelID、安装器命名、桌面快捷方式和图标策略。

### 修复
- 会话重命名改为网页内弹窗，不依赖浏览器原生 `prompt`。
- 会话删除改为网页内确认弹窗，不依赖浏览器原生 `confirm`。
- 桌面快捷方式统一指向安装版 exe 和黑色 Viniper 图标。
- 构建产物、GitHub Release 和 tag 保留策略自动清理旧版本。

## v0.2.8 (2026-05-19)

### 修复
- Windows 自动更新优先下载并打开新版安装器，确保 exe、任务栏图标和快捷方式随版本同步。
- Windows 图标改为多尺寸 ICO，并切换桌面壳 AppUserModelID，降低任务栏读取旧缓存的概率。
- 启动时刷新桌面、开始菜单和已固定任务栏中的 Viniper UI 快捷方式。
- 设置页新增“创建桌面快捷方式”按钮，可一键恢复到软件版入口。

## v0.2.7 (2026-05-19)

### 修复
- 增加会话重命名按钮事件兜底，确保 Electron 环境里可响应。

## v0.2.6 (2026-05-19)

### 修复
- 会话重命名事件改为事件委托，减少 `innerHTML` 重建导致监听丢失的问题。

## v0.2.5 (2026-05-19)

### 修复
- `需要时确认` 映射到 Claude Code 默认权限策略，让 Claude Code 在真正需要授权时处理确认。

## v0.2.4 (2026-05-19)

### 修复
- 精简前端权限模式选项，与 Claude Code 底层权限策略对齐。
- 修复桌面壳图标，统一使用黑色 Viniper 图标。
- 增强版本自检流程。

## v0.2.3 (2026-05-19)

### 修复
- 移除界面和桌面壳残留的旧图标，统一为黑色 Viniper 图标。
- 新建会话默认命名为 `新建会话（1）`、`新建会话（2）`、`新建会话（3）`。
- 删除会话时同步清理对应附件和临时运行目录。
- 每个 UI 会话使用独立 Claude Code session id，避免不同会话共享上下文。
- 移除错误的 `--mcp-config=目录` 参数，避免 Claude Code 因 MCP 配置路径无效而启动失败。
