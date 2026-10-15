# Viniper 2.0

Viniper 是一个用于本机文件、代码和资料任务的桌面 Agent。它使用同一个 Harness Runtime 管理会话、模型、工具、访问权限和执行记录，提供原生 macOS `.app` 入口。

2.0 重构了整个界面：月白与夜青主题、统一的模型和智能程度菜单、带图标的权限选择、默认折叠的思考与工具过程、可点击的文件和网页链接，以及消息位置导航。输入框的 **+** 菜单提供附件、规划模式、目标模式和技能入口。

- **规划**：先用只读工具调研，输出方案；选择开始实施后才进入执行模式。
- **目标**：围绕明确成果持续推进，轮次、暂停、继续与完成状态可见。没有执行进展时停止自动续轮。
- **引导**：运行中输入补充方向，点“引导”或按 `⌘Enter`，在当前安全步骤之后送给模型；普通 `Enter` 加入待发送队列。
- **定时任务**：支持五字段 Cron；使用 Viniper 当前模型与工具权限执行。应用退出期间错过的时刻不补跑；忙会话等待空闲后执行一次。
- **技能与插件**：包含本机文档、SQLite、项目代码、网络读取和会话协作工具；本机与项目技能按需读取。

配置本机数学组件后，数学与 PDF 插件提供结构化讲义制作、只读页面提取和页面渲染工具。模型直接提交题目与完整原解，不必在终端拼接 JSON；师生 PDF 与 TeX 源文件显示为成果卡片，编译过程留在执行详情。页面渲染和视觉检查分别记录，不能把编译成功当作版式已经检查。

Claude Code 已从应用内移除。它可以继续作为独立 CLI 在终端使用；升级不删除其安装、配置或旧会话。

## macOS

使用说明见 [Mac 版说明](docs/macOS本机版.md)。Apple Silicon 本机构建：

```sh
npm ci
npm run setup:electron
npm run setup:macos-signing
npm run package:macos
npm run install:macos -- --desktop-shortcut
```

构建内置 Node，安装器为应用准备独立的 Python 环境；本次本机安装使用 Python 3.15.0。首次固定签名设置可能需要本人在系统窗口授权，之后更新复用该身份与凭据组件。显示名和安装入口为 **Viniper.app**；升级沿用旧版的数据目录和固定签名身份，因此不会通过改名重置设置、会话或密钥。源码不包含个人凭据。

当前 Mac 包采用本机证书签名，未做 Apple Developer ID 公证。其他电脑需要按上述步骤建立自己的签名及 Python 环境；本机签名连续性不等同于 Apple 公证或所有设备上的免提示安装。

开发验证：

```sh
npm run typecheck
npm test
```

macOS 与 Windows 分别验收；本次 2.0 的交付目标是 Apple Silicon macOS，不能据此认定 Windows 安装器已经完成回归。版本与下载见 [GitHub Releases](https://github.com/Viniper-Chu/viniper-ui/releases)。
