## v0.2.3 (2026-05-19)

### 修复
- **图标统一**：移除界面和桌面壳里残留的哈士奇图标与 Claude 橙色图标，统一使用黑色 Viniper 图标。
- **新建会话命名**：未手动命名的新会话统一命名为 `新建会话（1）`、`新建会话（2）`、`新建会话（3）`。
- **删除会话**：删除按钮改为明确的按钮事件；删除当前会话后自动切到剩余最近会话，没有剩余会话时再创建新会话。
- **会话隔离**：每个 UI 会话继续使用独立 Claude Code session id，并在系统提示中声明不要引用其他 UI 会话记忆；删除会话时同步清理该会话附件和临时运行目录。
- **权限确认**：`需要时确认` 不再在发送前预判弹窗，而是映射到 Claude Code 默认权限策略，让底层在真正需要时处理确认。
- **启动失败**：修复 `VERSION` 与桌面壳 `desktop/package.json` 版本不一致导致的 0.2.3 自检失败。
- **Claude Code 启动参数**：移除错误的 `--mcp-config=目录` 参数，避免 Claude Code 因 MCP 配置路径无效而启动失败。

### 验证
- `python -m py_compile server.py`
- `node --check static/app.js`
- `node --check desktop/main.js`
- `python scripts/verify_app.py`
- `python scripts/verify_release.py`
