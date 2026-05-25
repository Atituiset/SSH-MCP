# 已知问题与改进建议

## 问题分级

| 级别 | 说明 |
|------|------|
| 🔴 Critical | 可能导致功能失效或数据错误 |
| 🟠 High | 影响可维护性或存在明显缺陷 |
| 🟡 Medium | 有改进空间，但当前可用 |
| 🟢 Low | 代码整洁度或性能优化建议 |

---

## 🔴 Critical

### C1. `addUbuntuTools` 覆盖 `ListToolsRequestSchema` 处理器

**位置：** `ubuntu-website-tools.ts:683`

**问题：** 该函数完全替换了 `ListToolsRequestSchema` handler，导致：
1. 其他模块注册的工具（network-switch, serial, ssh-setup, console-transition, firmware）**不会出现在 Claude 的工具列表中**
2. `ListTools` 返回的 schema 与 `Server` 构造函数中 `capabilities.tools` 声明不一致
3. 新增核心工具时必须同步修改两处硬编码列表

**修复建议：**
```typescript
// 引入统一的工具注册中心
const globalRegistry = {
  schemas: {} as Record<string, ToolSchema>,
  handlers: {} as Record<string, ToolHandler>
};

export function registerTool(name: string, schema: ToolSchema, handler: ToolHandler) {
  globalRegistry.schemas[name] = schema;
  globalRegistry.handlers[name] = handler;
}

// setupHandlers 中统一挂载
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: Object.entries(globalRegistry.schemas).map(...)
}));
```

### C2. `ubuntu_website_deployment` 目录部署逻辑错误

**位置：** `ubuntu-website-tools.ts:331`

```typescript
await executeSSHCommand(conn, `zip -r ${tempZipFile} ${expandedLocalPath}`);
```

**问题：** 尝试在远程服务器上 zip 一个本地路径。`expandedLocalPath` 是客户端文件系统路径，远程服务器不存在此路径。

**修复建议：** 使用本地 `adm-zip` 或 `archiver` 库在本地打包，然后上传 zip 文件。

---

## 🟠 High

### H1. 工具注册函数未被调用

**位置：** `index.ts`

**问题：** 源码中导入了 `addUbuntuTools` 并在构造函数中调用，但其他模块的 `addXTools` 函数（`addNetworkSwitchTools`、`addSerialConnectionTools`、`addSSHSetupTools`、`addConsoleTransitionTools`、`addFirmwareTools`）虽然被定义和导出，但在 `index.ts` 中**没有被调用**。

这意味着 network-switch、serial、firmware 等工具虽然在代码中存在，但 MCP Server 启动时并未实际注册它们。

**修复建议：** 在 `SSHMCPServer` 构造函数中依次调用所有 `addXTools` 函数：
```typescript
constructor() {
  // ...
  addUbuntuTools(this.server, this.connections);
  addNetworkSwitchTools(this.server, this.connections);
  addSerialConnectionTools(this.server);
  addSSHSetupTools(this.server, this.connections, serialConnections);
  addConsoleTransitionTools(this.server, serialConnections);
  addFirmwareTools(this.server, this.connections);
}
```

### H2. 多处代码重复

**位置：** 跨多个模块

**重复项：**
1. `executeSSHCommand` / `executeNetworkCommand` — 在 `ubuntu-website-tools.ts`、`network-switch-tools.ts`、`switch-firmware-tools.ts` 中几乎相同
2. `getConnection` — 在三个模块中重复
3. SFTP 初始化代码 — `index.ts` 和 `switch-firmware-tools.ts`
4. Tilde 展开 — `index.ts` 和 `ubuntu-website-tools.ts`

**修复建议：** 提取公共工具模块 `src/utils.ts`：
```typescript
export async function executeSSHCommand(conn: Client, command: string, timeout?: number);
export function getConnection(connections: Map, connectionId: string): Client;
export function expandTilde(path: string): string;
export async function initSFTP(conn: Client): Promise<any>;
```

### H3. IP 地址验证不严格

**位置：** `ssh-setup-tools.ts:111-122`

```typescript
/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
```

**问题：** `999.999.999.999` 会通过验证。应使用更严格的校验（如引入 `net` 模块的 `isIPv4` 或自定义校验每个 octet 范围）。

---

## 🟡 Medium

### M1. 串口连接 Map 的类型安全

**位置：** `serial-connection-tools.ts:297`

```typescript
let serialConnections: Map<string, { port: RealSerialPort; config: SerialConnection }> = new Map();
```

**问题：** `RealSerialPort` 类没有导出（仅模块内可见），但 `console-transition-tools.ts` 和 `ssh-setup-tools.ts` 通过 `getSerialConnections()` 获取此 Map，它们只能看到 `any` 类型。

**修复建议：** 导出 `SerialConnectionState` 接口类型：
```typescript
export interface SerialConnectionState {
  port: RealSerialPort;
  config: SerialConnection;
}
```

### M2. 命令超时不 kill 远程进程

**位置：** `index.ts:466-468`

```typescript
const timeoutId = setTimeout(() => {
  reject(new Error(`Command execution timed out after ${timeout}ms`));
}, timeout);
```

**问题：** 超时后 Promise reject，但 ssh2 不会在服务器端终止进程。一个 `npm install` 超时后仍在后台运行，可能占用资源或产生副作用。

**修复建议：** 超时后调用 `stream.close()` 或发送 SIGTERM：
```typescript
const timeoutId = setTimeout(() => {
  stream.close();  // 或 stream.signal('SIGTERM')
  reject(new Error(`Command timed out`));
}, timeout);
```

### M3. 全局 Map 的生命周期管理

**问题：** `connections` 和 `serialConnections` Map 只增不减（除非显式 disconnect）。如果 AI 忘记调用 disconnect，连接会永久泄漏。

**修复建议：** 添加定期清理或最大连接数限制：
```typescript
// 在 start() 中
setInterval(() => {
  for (const [id, {conn}] of this.connections) {
    if (!conn._sock?.readable) {
      this.connections.delete(id);
    }
  }
}, 60000);
```

### M4. `ubuntu-website-tools.ts` 中 `console.log` 混用

**位置：** `ubuntu-website-tools.ts:782`

```typescript
console.log("Ubuntu website management tools loaded");
```

**问题：** 其他模块使用 `console.error()` 输出日志（因为 stdout 被 MCP 协议占用），而此处使用 `console.log()`，可能污染 JSON-RPC 通信流。

**修复建议：** 统一改为 `console.error()`。

---

## 🟢 Low

### L1. TypeScript 严格模式下的隐式 any

**位置：** 多处回调参数

```typescript
(err: Error | undefined, stream: any)  // stream 应该是 ClientChannel
```

**修复建议：** 安装 `@types/ssh2` 并使用正确类型（已安装，但未充分利用）。

### L2. 魔法数字

**位置：** 分散在各处

```typescript
16384    // S_IFDIR
code === 0  // 成功判断
```

**修复建议：** 使用常量：
```typescript
const S_IFDIR = 0o40000;
const EXIT_SUCCESS = 0;
```

### L3. `fs.existsSync` 已被标记为遗留 API

**位置：** `index.ts:532`

**修复建议：** 使用 `fs.promises.access()`：
```typescript
await fs.promises.access(expandedLocalPath).catch(() => {
  throw new Error(`Local file does not exist`);
});
```

### L4. `.gitignore` 已忽略 `build/` 但历史提交中包含

**问题：** 仓库历史中 `build/` 目录和 `package-lock.json` 曾被提交。当前 `.gitignore` 已正确配置，但旧的构建产物仍在 git 历史中。

**修复建议（可选）：** 如需要清理历史，使用 `git filter-repo` 或 `git filter-branch` 移除。

---

## 改进路线图建议

### 短期（v1.2.0）
1. 修复 `addUbuntuTools` 的 ListTools 覆盖问题（Critical）
2. 修复 `ubuntu_website_deployment` 的 zip 逻辑（Critical）
3. 在 `index.ts` 中补全所有 `addXTools` 调用（High）
4. 提取公共工具模块减少代码重复（High）

### 中期（v1.3.0）
1. 引入统一的工具注册表机制
2. 添加连接健康检查和自动清理
3. 命令超时后 kill 远程进程
4. 完善类型定义，消除 `any`

### 长期（v2.0.0）
1. 考虑引入 `Server` 级别的插件系统，各模块作为独立插件注册
2. 支持配置文件驱动的工具加载（`mcp.config.json`）
3. 增加单元测试覆盖（当前无测试）
4. 考虑 SSE 或 HTTP 传输模式以支持远程部署
