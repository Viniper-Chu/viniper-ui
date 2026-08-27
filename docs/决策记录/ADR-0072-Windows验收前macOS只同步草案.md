# ADR-0072：Windows Preview 验收前，macOS 只同步实现草案

- 状态：Accepted
- 日期：2026-08-13
- 决策人：用户 / Viniper Harness 管理层
- 适用版本：`v0.0.1 Preview`

## 背景

用户此前已明确要求 Windows 原生运行，macOS 当前可以暂缓，但每一阶段仍须维护对应草案。当前没有 Mac 真机，同时开发两套可执行包会把未验证的平台行为混入首个交付。

## 决策

- Windows 是当前唯一实现与真机验收主线；先完成可运行的 `v0.0.1 Preview` 便携版。
- 每个 Windows 功能阶段都同步更新 macOS 草案，说明共享领域合同、平台适配点、arm64/x64、Keychain、路径、权限、菜单、信号和打包风险。
- 在 Windows Preview 达到阶段验收且取得 Mac 真机之前，不产出 macOS 包、不宣称可运行、不把 TypeScript 通过写成 macOS PASS。
- core/features 保持平台无关；Windows 专属路径、PowerShell、注册表或 DPAPI 语义不得进入共享领域层。

## 收益

- 当前开发资源集中在用户能够实际验证的平台。
- macOS 不会被遗忘，也不会因 Windows 快速实现而被架构锁死。

## 代价

- macOS 用户暂时没有可运行交付物。
- 草案不能替代 Keychain、菜单、签名、公证和真机行为证据。

## 与既有决策的关系

- 延续既有 macOS 草案的 `UNPROVEN / 无 Mac 真机` 状态，不改变最终 Windows/macOS 双平台目标。

