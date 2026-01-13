# NetDebugger

这是一个基于 `Tauri + React + TypeScript (Vite)` 的网络调试工具，集成了 UDP/TCP 的 Server/Client 功能，便于发送/接收报文、回放指令集与快速调试。

**项目结构**
- **`src/`**: 前端 React 应用，UI 与交互逻辑位于 `src/App.tsx`。
- **`src-tauri/`**: Tauri / Rust 后端，网络逻辑散布在 `src-tauri/src/`（例如 `udp_server.rs`、`udp_client.rs`、`tcp_server.rs`、`tcp_client.rs`）。

**特性概览**
- **UDP/TCP Server & Client**: 绑定端口、接收/发送消息、查看已连接客户端。
- **指令集（Commands）**: 可保存/导入/导出常用指令，应用到当前激活的视图（UDP/TCP、Server/Client）。
- **历史记录**: 发送目标、发送内容与绑定信息保存在 `localStorage`。
- **程序员计算器**: 内置计算器便于处理十六进制/二进制数值。

**快速开始（开发）**

1. 安装依赖：

```bash
pnpm install
```

2. 启动前端开发服务器（Vite）：

```bash
pnpm dev
```

3. 如果需要在 Tauri 环境中运行（开发模式）：

```bash
pnpm run tauri dev
```

4. 生产打包（前端构建 + Tauri 打包）：

```bash
pnpm build
pnpm run tauri build
```

**注意 / 前置环境**
- 需要安装 `Node.js`（推荐 LTS）和 `pnpm`。
- Rust 工具链（`rustup`、`cargo`）与 Tauri 所需系统依赖（详见 Tauri 官方文档）。

**使用说明（重点）**
- 打开应用后，通过侧边栏选择视图：`UDP Server` / `UDP Client` / `TCP Server` / `TCP Client`。
- 指令集：点击右下角的指令图标打开指令侧栏，可以 `导入` / `导出` / `新增` / `移除` 指令。
- 应用指令：在指令列表点击 “应用” 时，指令会注入到当前激活的视图（例如你正在看 `UDP Client`，则将填入该视图的发送框）。此功能由前端在 `src/App.tsx` 通过 `nd:applyCommand` 事件分发并由各视图监听实现。
