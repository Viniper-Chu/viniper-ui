# Viniper workstation 项目规则

## 产品边界

- 本项目是 `Viniper workstation` 的唯一合并工程；`D:\Agent` 与 `D:\Viniper UI\source\viniper-ui` 只作为来源和验收基线，在最终归档门槛前不得改写。
- 产品只有一个 Harness Runtime、一个 Application Port 和一个结构化数据真源。`Viniper` 是自研 Harness Agent，`Claude code` 是 Claude Code Engine Adapter；界面不能直接写 SQLite、拼 Provider 请求或持有明文密钥。
- 前端结构、信息层级、会话轨迹、输入区、菜单和设置布局向 Viniper 看齐；颜色、图标、启动动画、托盘和菜单资产使用 Harness 品牌语言。
- 两个 Agent 的通用动作必须共用位置和语义；只有能力探测确认的差异才允许额外展示，并采用渐进披露。

## 工作边界

- 生产代码和正式文档留在本项目；临时日志、截图、检查输出和一次性脚本进入 `codex\运行残留`、`codex\工作输出`、`codex\脚本工具`、`codex\审查报告`。
- 不写哈希或 SHA256，不用低概率防御矩阵替代正常产品验证。
- 未经用户明确授权，不发布远端版本、不上传、不扩大付费 Provider 调用、不改远端权限。
- Windows 必须真实运行和验证；macOS 每轮同步架构与打包差异，但真机保持 `UNPROVEN`。

## 验收边界

- 源码测试、UI 合同、视觉截图、安装候选和正式桌面入口分别报告，不用前者代替后者。
- 在新工程的类型检查、自动测试、桌面运行、图标/动画、安装、数据保护和有界真实 Agent 验证全部通过前，不归档旧项目，不替换桌面入口。
- 清理或归档必须先解析准确绝对路径并采用可恢复方式；不删除用户数据、配置、凭据、会话、`.git` 或回滚证据。
