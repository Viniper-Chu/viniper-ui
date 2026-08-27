# ADR-0079：命令工作台与真实 Agent 验收

状态：已采纳  
日期：2026-08-14

## 决策

Viniper Harness 增加桌面“命令工作台”，但它只是同一 Agent Runtime 的专用观察与操作表面：用户输入仍进入 Agent，终端命令仍由 `terminal.run`、PermissionPolicy、受管进程和统一 activity 执行。桌面不嵌外部 CLI，不直接执行 shell，也不复制终端状态。

采纳 Claude Code 与 Hermes CLI/TUI 的固定输入区、流式工具输出、状态栏、历史恢复、slash 发现和 interrupt 语义；视觉继续服从现有冷青连续工作台，不复刻 ANSI 或品牌外观。

高频控制采用“图标优先、必要文字常显”的密度策略：主页、顶部菜单、发送以及设置和衍生页面的明显动作移除重复可见文字，以 hover/focus tooltip、`title` 与 `aria-label` 保留完整含义；新建会话/打开项目、保存/确认、删除、安装/信任、权限、运行状态等重要或有风险动作继续显示文字。图标外框统一使用克制的柔和圆角；图标化不得牺牲键盘可达性、点击热区或窄窗适配。

公共网页读取作为独立 `web` 功能域和 `external` 权限工具进入公共 ToolRegistry。Skill、插件、编程、终端、网页和真实 Provider 验收都必须穿过同一生产链。

系统身份固定为 Viniper Harness；底层模型是可替换推理 Provider，不是产品身份。

## 理由

终端用户需要高密度、连续、可中断的执行表面，但绕过 Agent/权限的桌面 shell 会制造第二执行真源。将命令工作台定义为 canonical activity 的专用投影，可以同时保留桌面易用性、CLI 效率、权限一致性和跨会话可恢复性。

真实验收用于证明完整产品链，不用于扩大所有 Provider 的认证结论；因此 DeepSeek 有界调用与其他 Provider 的本地协议证据分开报告。

## 后果

- 新终端页必须消费现有 application port/IPC，不直接访问文件或进程。
- 网页读取必须显式属于外部权限域，并将页面内容视为不可信资料。
- 任何直接 `fetch` DeepSeek、直接执行测试插件或直接改测试项目的脚本只能做 harness 辅助，不能成为产品通过证据。
- 产品问“你是什么”时稳定回答 Viniper Harness；Provider/model 可作为附加运行信息展示。
