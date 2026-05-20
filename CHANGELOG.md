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
