# Viniper Desktop

此目录是 Viniper 的 Electron 桌面壳。它负责原生窗口、托盘、单实例、启动动画、本地服务生命周期与正式/Preview Profile 接线，不改变 Claude Code 的工具与权限语义。

## 开发

```powershell
cd desktop
npm install
npm start
```

## 构建

从仓库根目录构建 Windows 安装器：

```powershell
python scripts/build_desktop.py --target win --skip-install
```

macOS 构建必须显式指定 `x64` 或 `arm64`：

```bash
python3 scripts/build_desktop.py --target mac --arch x64
python3 scripts/build_desktop.py --target mac --arch arm64
```

产物写入被 Git 忽略的 `desktop/release/`。正式构建使用显式白名单资源 staging，包内包含 `server.py`、Agent/上下文/用量/技能同步等运行模块、静态资源与原 Viniper 图标，不遍历 `codex/`、`.omx/`、数据目录或旧 release。

## Profile 与数据

- 正式显示名：Viniper；App ID 继续使用 `com.viniper.ui.desktop` 以保持升级兼容。
- Preview 显示名：Viniper Preview；端口、安装目录和 `%APPDATA%\Viniper Preview` 与正式版隔离。
- 正式版继续使用 `%APPDATA%\Viniper UI` 兼容数据根；更新不得清空 sessions、settings、`AGENT.md`、skills、attachments 或凭据。
- 窗口关闭默认隐藏到托盘；托盘提供显示、设置、自检、数据目录和退出等真实动作。
