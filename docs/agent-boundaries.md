# Agent 边界与本轮优化（1.8.2–1.8.3）

桌面宿主管理凭据、进程和安装器；HTTP Application Port 管理会话与协议投影；Viniper Harness 和 Claude Code Adapter 分别拥有各自执行生命周期。前端消费状态与事件，不执行 Provider 请求、不写 SQLite，也不读取明文 Key。

## 独立模块

- `model-capabilities.json`：维护模型 API ID、标签、兼容别名和可信容量。
- `model_catalog.py`：纯函数生成选项、迁移官方 DeepSeek 部署；不依赖 HTTP、会话、密钥服务。其他部署和自定义模型不自动重命名。
- `harness_provider_boundary.js`：Provider-facing ID 与地址投影；使用同一打包目录。
- `static/agent-stream.js`：SSE 解码、后端状态确认、按会话合并重绘；不依赖 DOM 或 Agent 模式。
- `agent_run_coordinator.py`：后台生产者独立于浏览器连接；有界回放、序号、缺口通知、终态快照。

## 不变量

1. 原始消息先接受并归属于后端运行；断线只能 GET 恢复订阅，不再次 POST 消息。
2. EOF 仅表示传输结束。只有同一 run_id 的后端 terminal 状态能确认完成。
3. 回放超出缓存窗口时重新读取持久会话，不能把残缺文本误当完整文本。
4. 所有事件仍逐项应用；合并的是 DOM 重绘，不是正文、工具调用或审批事件。
5. 模型切换后的旧用量响应以及过期模式 generation 不覆盖新状态。
6. 内置右下角预设统一显示 `DeepSeek V4.1 Flash`，实际 ID 为 `deepseek-flash`；官方地址上的旧 Pro/Flash 双选预设归并为 Flash。自定义网关、自定义列表和历史记录不改写，Pro API 兼容仍保留。原生 Claude 主模型的 `[1m]` 只存在于 CLI 边界。

## 检查边界

本轮全量回归覆盖仓库现有测试集合，并新增模型迁移、传输解析、重连、回放缺口、重绘调度和请求竞态测试。安装包、实际 Windows 界面、受控 Agent 运行与本机数据保护另做验证。测试通过不是“软件零缺陷”的证明。

`server.py` 和 `static/app.js` 仍承担较多组合与展示责任；后续可按设置、工作区和会话查询继续提取，本次不把所有模块重写为另一套框架。macOS 真机验证保持 UNPROVEN。

官方来源（2026-09-18 核实）：

- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/
