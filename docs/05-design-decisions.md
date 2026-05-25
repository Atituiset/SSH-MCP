# 关键设计决策分析

## 1. 为什么使用 StdioServerTransport？

MCP 协议支持多种传输层（stdio、HTTP/SSE、WebSocket）。本项目选择 stdio：

**优点：**
- 零网络暴露：MCP Server 作为子进程启动，无需监听端口
- 安全隔离：通过操作系统进程隔离实现权限边界
- 配置简单：Claude Desktop 只需配置 `command` + `args`
- 即开即用：每次 MCP Client 启动时自动拉起 Server

**缺点：**
- 无法远程部署：Server 必须与 Client 在同一主机
- 进程生命周期耦合：Client 关闭则 Server 终止
- 调试困难：stderr 被重定向到日志，stdout 被协议占用

**决策结论：** 对于需要访问本地 SSH 密钥和串口设备的场景，stdio 是最合理的选择。

## 2. 为什么用 Map 而不是 Connection Pool？

SSH 连接管理采用最简单的 `Map<string, Connection>`：

**放弃连接池的理由：**
- MCP 会话通常是短命的（一次对话一个任务）
- AI 用户倾向于显式控制连接生命周期（"连接到服务器 X" → "执行 Y" → "断开"）
- 网络设备（交换机）通常需要独占式管理，复用连接可能导致配置冲突

**Map 的 trade-off：**
- 无自动重连：连接断开后需手动重新 `ssh_connect`
- 无连接健康检查：Map 中可能存储已断开的 Client 实例
- 无最大连接数限制：可无限创建连接

## 3. 模块化工具架构的演进

项目从单一文件逐步拆分为多个模块，反映了功能增长路径：

```
Phase 1: index.ts 单文件
  └─ 核心 SSH 工具

Phase 2: + ubuntu-website-tools.ts
  └─ 业务导向的扩展工具

Phase 3: + serial-connection-tools.ts
  └─ 全新连接方式（USB Serial）

Phase 4: + network-switch-tools.ts
  └─ 交换机专用命令封装

Phase 5: + ssh-setup-tools.ts
  └─ 配置模板和自动化

Phase 6: + console-transition-tools.ts
  └─ 跨模块工作流编排

Phase 7: + switch-firmware-tools.ts
  └─ 固件生命周期管理
```

**拆分原则：** 按连接方式（SSH vs Serial）和按目标设备（Linux vs Switch）双重维度组织。

## 4. 为什么用正则模式匹配做命令超时评估？

`evaluateCommandTimeout` 采用基于正则的启发式策略，而非静态配置表：

**对比方案：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 正则模式匹配（当前） | 无需维护配置表，自动适应新命令变体 | 可能误判（如 `echo "npm install"`） |
| 静态命令映射表 | 精确、可预测 | 维护成本高，无法覆盖所有命令组合 |
| 机器学习分类 | 理论上最准确 | 过度设计，增加复杂度和依赖 |

**当前设计的智慧：** 使用 `\b` 单词边界锚点降低误报率，同时按命令类别（包管理器、容器、构建等）分层评估。对于边缘情况，始终保留用户显式覆盖的通道。

## 5. 串口 Prompt 检测的设计哲学

`RealSerialPort` 的响应读取不是简单地 `read(n)` 字节，而是**语义级读取**：

```typescript
private hasCompleteResponse(): boolean {
  return PROMPT_PATTERNS.user.test(this.buffer) ||
         PROMPT_PATTERNS.enable.test(this.buffer) ||
         PROMPT_PATTERNS.config.test(this.buffer) ||
         ...;
}
```

**为什么不用固定字节数或固定超时？**
- 网络设备响应时间差异巨大（简单命令 100ms，show run 可能需要分页交互 30s+）
- 固定超时会导致频繁超时或不必要的等待
- Prompt 是设备响应完成的**语义信号**，比时间更可靠

**Paging 处理的必要性：** Cisco/Aruba 的终端默认启用分页（每 24 行暂停）。`sendCommand` 自动检测 `--More--` 并发送空格继续，这对于获取完整配置至关重要。

## 6. 配置模板 vs. 程序化生成

`ssh-setup-tools.ts` 使用字符串模板数组而非程序化构建配置：

```typescript
// 当前方案：字符串模板
const template = [
  'configure terminal',
  'hostname {hostname}',
  'crypto key generate rsa general-keys modulus 2048',
  ...
];

// 替代方案：程序化 API（未采用）
function generateConfig(deviceType, params) {
  const config = new CiscoConfig();
  config.setHostname(params.hostname);
  config.generateCryptoKey({ modulus: 2048 });
  return config.toCLI();
}
```

**选择模板方案的理由：**
- 网络工程师可直接阅读和修改模板
- 模板本身就是文档
- 不同安全级别（basic/secure）的差异一目了然
- 无需构建抽象配置对象模型

## 7. 错误处理策略：返回 vs. 抛出

项目统一采用 MCP Content 错误返回模式：

```typescript
return {
  content: [{ type: "text", text: "错误描述" }],
  isError: true
};
```

**而不是：**
```typescript
throw new Error("...");  // 会导致 MCP SDK 返回 JSON-RPC error
```

**原因：**
- MCP 协议的 `isError` 标记让 LLM 知道操作失败，但仍能获取完整的上下文信息
- 抛出的异常通常只包含简短 message，丢失了 stdout/stderr 等关键调试信息
- LLM 可以根据详细的错误输出自行决定重试策略或替代方案

**唯一的 throw 场景：** 在 `CallTool` handler 内部，未知工具名会抛出 `Error`，这由 MCP SDK 捕获并转为 JSON-RPC error response，属于协议层面的错误（Client 请求了不存在的工具）。

## 8. 生产验证驱动开发

README 中强调该项目经过生产环境验证：

- **真实场景测试：** 在活的 Cisco/Aruba 交换机上运行
- **零停机承诺：** 未造成网络中断
- **时间收益量化：** SSH 配置从 15-20 分钟缩短到 2 分钟以下
- **硬件兼容性覆盖：** 多种 USB 转串芯片和交换机型号

这反映了设计决策的实用主义倾向：优先考虑**可靠性**和**可预测性**，而非理论上的完美抽象。
