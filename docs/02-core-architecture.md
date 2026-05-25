# 核心架构分析

## 1. SSHMCPServer 类 — 系统心脏

位于 `src/index.ts:23-741`，是唯一的全局单例类。采用 **集中式连接管理 + 模块化工具注册** 的架构模式。

```typescript
class SSHMCPServer {
  private server: Server;                          // MCP SDK Server 实例
  private connections: Map<string, { conn: Client; config: any }>;
}
```

### 1.1 生命周期

```
new SSHMCPServer()
  ├─ constructor()
  │   ├─ new Server(...)          // 创建 MCP Server，声明 capabilities
  │   ├─ setupHandlers()          // 注册 ListTools + CallTool 处理器
  │   └─ addUbuntuTools()         // 挂载 Ubuntu 工具（有副作用！见下文）
  │
  └─ start()
      ├─ new StdioServerTransport()  // 基于 stdio 的 JSON-RPC 传输
      ├─ server.connect(transport)   // 阻塞等待 MCP 客户端连接
      └─ SIGINT 信号处理             // 优雅关闭所有 SSH 连接
```

### 1.2 连接管理模型

所有 SSH 连接共享一个全局 `Map<string, Connection>`：

```typescript
Map<connectionId, {
  conn: Client;        // ssh2 Client 实例（底层 TCP 连接）
  config: {            // 用户提供的连接元数据
    host: string;
    port: number;
    username: string;
  }
}>
```

**关键设计：连接 ID 由调用方或系统生成**
- 用户可显式提供 `connectionId`
- 默认生成 `ssh-${Date.now()}`
- 所有后续工具调用都必须携带此 ID 进行路由

---

## 2. 工具注册机制 — 双轨制架构

项目存在 **两套并行的工具注册系统**，这是当前架构中最需要关注的特征。

### 2.1 轨道 A：构造函数内嵌注册（核心 SSH 工具）

在 `index.ts` 的 `Server` 构造函数 `capabilities.tools` 中直接声明：

```typescript
new Server({
  capabilities: {
    tools: {
      ssh_connect: { inputSchema: {...} },
      ssh_exec:    { inputSchema: {...} },
      ...
    }
  }
})
```

然后在 `setupHandlers()` 中通过 `setRequestHandler(ListToolsRequestSchema, ...)` 和 `setRequestHandler(CallToolRequestSchema, ...)` 注册处理器。

### 2.2 轨道 B：模块级附加注册（扩展工具）

各功能模块通过 `addXTools(server, connections)` 函数附加工具：

```typescript
addUbuntuTools(server, connections);      // ubuntu-website-tools.ts
addNetworkSwitchTools(server, connections); // network-switch-tools.ts
addSerialConnectionTools(server);          // serial-connection-tools.ts
addSSHSetupTools(server, connections, serialConnections); // ssh-setup-tools.ts
// ... 等等
```

**严重问题：`addUbuntuTools` 完全覆盖了 `ListToolsRequestSchema` 处理器**

在 `ubuntu-website-tools.ts:683`：
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // 手动重列所有核心 SSH 工具 + Ubuntu 工具
    { name: 'ssh_connect', ... },
    ...
    ...ubuntuTools
  ]
}))
```

这导致：
- 如果先调用 `setupHandlers()` 再调用 `addUbuntuTools()`，后者会覆盖前者
- `ListTools` 返回的工具列表与 `capabilities.tools` 声明不一致
- 维护风险极高：新增核心工具时必须同步修改 `addUbuntuTools` 内的硬编码列表

### 2.3 理想的统一注册机制

当前代码应该将工具元数据和处理器统一到一个注册表中：

```typescript
interface ToolRegistry {
  schemas: Record<string, ToolSchema>;
  handlers: Record<string, ToolHandler>;
}

// 各模块只注册自己的工具
const registry: ToolRegistry = {
  schemas: {},
  handlers: {}
};

function registerModule(module: ToolRegistry) {
  Object.assign(registry.schemas, module.schemas);
  Object.assign(registry.handlers, module.handlers);
}

// 最后统一挂载到 server
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: Object.entries(registry.schemas).map(...)
}));

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const handler = registry.handlers[request.params.name];
  return handler(request.params.arguments);
});
```

---

## 3. 命令执行与超时评估

### 3.1 动态超时评估器 `evaluateCommandTimeout`

`index.ts:307-360`，v1.1.0 新增的核心特性。基于正则模式匹配自动推断合理超时：

| 命令类别 | 匹配模式 | 超时时间 |
|----------|----------|----------|
| npm/yarn/pnpm install, ci | `\b(npm\|yarn\|pnpm)\b` + `\b(install\|ci)\b` | 10 min |
| npm build | + `\b(run build\|build)\b` | 5 min |
| docker build | `\bdocker\b` + `\bbuild\b` | 30 min |
| docker push/pull | + `\b(push\|pull)\b` | 10 min |
| git clone/fetch | `\bgit\b` + `\b(clone\|fetch)\b` | 5 min |
| make/cmake/gradle | `\b(make\|cmake\|gradle...)\b` | 10 min |
| 测试框架 | `\b(test\|jest\|pytest...)\b` | 5 min |
| 多命令链 | `&&`, `\|`, `;` >= 3 个 | 5 min |
| 默认 | 其他所有命令 | 60 sec |

**优先级：** 用户显式 `timeout` 参数 > 自动评估 > 默认 60s

### 3.2 SSH keepalive 机制

`index.ts:387-388`，v1.1.0 新增，解决空闲断连问题：

```typescript
const sshConfig = {
  keepaliveInterval: 30000,  // 每 30s 发送 keepalive 包
  keepaliveCountMax: 3,      // 允许连续 3 次未响应后断开
};
```

这意味着连接最多可容忍 90 秒的网络中断，同时每 30 秒的活动能防止 NAT/防火墙的空闲超时。

---

## 4. 错误处理模型

统一采用 **MCP Content 错误返回模式**：

```typescript
return {
  content: [{ type: "text", text: "错误描述..." }],
  isError: true          // MCP SDK 标记为错误
};
```

而不是抛出异常。这使得错误信息能直接流回 AI 客户端，让 LLM 获得可操作的上下文。

---

## 5. 依赖注入与全局状态

项目使用 **模块级全局变量** 进行连接映射共享：

```typescript
// network-switch-tools.ts
let connectionMap: Map<string, { conn: Client; config: any }>;

export function addNetworkSwitchTools(server, connections) {
  connectionMap = connections;  // 运行时注入
}
```

**优点：** 简单直接，零样板代码  
**缺点：** 单测难以 mock；模块加载顺序敏感；TypeScript 严格模式下有隐式 any 风险

---

## 6. 传输层选择

使用 `StdioServerTransport`，即通过标准输入输出进行 JSON-RPC 通信：

```
Claude Desktop (MCP Client)
    │  JSON-RPC over stdio
    ▼
node build/index.js (MCP Server)
    │  ssh2 / serialport
    ▼
Remote Server / Switch / Serial Port
```

这是 MCP 协议中最简单的传输方式，无需网络端口暴露，天然适合本地运行的 CLI 工具。
