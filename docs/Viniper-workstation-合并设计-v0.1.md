# Viniper workstation 合并设计 v0.1

## 产品命题

`Viniper workstation` 是一个本地优先的双 Agent 工作台：`Viniper` 使用自研 Harness Runtime，`Claude code` 使用 Claude Code Engine Adapter。两个入口共享同一套项目、会话、时间线、输入与设置骨架，但运行状态、模型、权限、上下文和引擎会话身份相互隔离。

## 视觉系统

视觉结构严格取自当前 Viniper：左侧双入口、少量常用导航、会话列表、中央会话区、底部悬浮输入框与左下环境菜单。品牌语言取自 Harness：

| Token | 值 | 用途 |
|---|---|---|
| Canvas mist | `#F4FAF9` | 主画布 |
| Surface | `#FFFFFF` | 输入框、选中会话、弹层 |
| Harness teal | `#168A91` | 主操作、活动状态、焦点 |
| Circuit cyan | `#22B8B5` | 轻提示、进度与图标细节 |
| Ink | `#15343B` | 正文与标题 |
| Divider | `#D7E7E5` | 分栏和层级线 |

字体使用 `Segoe UI Variable`、`Microsoft YaHei UI` 和系统回退。界面不再使用当前 Harness 的中央大卡片、四格快捷入口和五个顶栏菜单图标。

## 布局

```text
┌────────────────────────────────────────────────────────────────────┐
│  ☰  ▣  搜索                                      V · 窗口控制       │
├───────────────┬────────────────────────────────────────────────────┤
│ Viniper |     │ 会话标题 · 工作目录                                │
│ Claude code   │                                                    │
│               │  消息 / 推理 / 工具 / 询问 / 产物                 │
│ ＋ 新建会话   │                                                    │
│   项目与目录  │                                                    │
│   自定义与技能│                                                    │
│               │                                                    │
│ 会话          │                                                    │
│ …             │       ┌────────────────────────────────────┐       │
│               │       │ 输入任务…                     发送 │       │
│ V 本地环境 ⌄  │       │ 权限 · 附件          模型 · 上下文 │       │
└───────────────┴───────┴────────────────────────────────────┴───────┘
```

## 记忆点

唯一强调元素是 Harness 的 V 电路节点：它出现在应用图标、启动动画、左下环境入口、发送进度和托盘状态中。其他区域保持 Viniper 的安静留白，不再添加装饰性仪表盘。

## 交互契约

- 顶部两个 Agent 标签只切换会话集合，不复制页面结构。
- 新建会话继承当前 Agent；项目选择、发送、停止、重命名、置顶、附件、模型和权限使用同一组控件。
- `Viniper` 设置优先展示 Provider、能力组合、Skills、插件、MCP、自动任务与自研工具。
- `Claude code` 设置在相同位置展示 Claude 模型、原生权限、运行时、会话恢复和 CLI 能力；专属项只在能力探测后出现。
- 通用按钮必须进入同一 `AgentDesktopApi`。renderer 不自行生成成功状态，不访问 SQLite，也不绕过 Runtime。

## 引擎边界

```text
Unified Renderer
      │
AgentDesktopApi / AppSnapshot / RuntimeEvent
      │
Single Harness Runtime + canonical persistence
      ├── Viniper provider/tool loop
      └── Claude Code Engine Adapter (WSL/native probe, stream-json, resume)
```

Claude Code 的工具执行属于其原生引擎语义，但必须投影为 canonical RuntimeEvent；权限、问题、工具开始/结束、文本、usage、取消和终态均由适配器回传，不能由前端猜测。

## 当前版本目标

- 产品名：`Viniper workstation`
- 版本：`0.1.0 Preview`
- Windows：真实构建、安装与运行验收
- macOS：同步接口和打包草案，真机 `UNPROVEN`
