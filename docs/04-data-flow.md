# 数据流与交互流程分析

## 1. 宏观数据流

```
┌─────────────────┐     JSON-RPC      ┌─────────────────┐     TCP/SSH     ┌─────────────────┐
│  Claude Desktop │ ◄──────────────► │  SSHMCPServer   │ ◄─────────────► │  Remote Linux   │
│  (MCP Client)   │    over stdio    │  (MCP Server)   │                 │  Server / Switch│
└─────────────────┘                  └─────────────────┘                 └─────────────────┘
                                              │
                                              │ USB Serial
                                              ▼
                                       ┌─────────────────┐
                                       │  USB-to-Serial  │
                                       │    Adapter      │
                                       │  (FTDI/CH340)   │
                                       └─────────────────┘
```

## 2. MCP 协议交互序列

### 2.1 工具发现阶段

```
Client                                  Server
  │ ─── ListToolsRequest ───────────────> │
  │                                       │ 遍历所有注册的工具 schema
  │ <──────── ListToolsResponse ──────── │
  │                                       │
  │ 返回：ssh_connect, ssh_exec,          │
  │       ubuntu_nginx_control,           │
  │       switch_show_interfaces, ...     │
```

### 2.2 连接建立阶段

```
Client                                  Server
  │ ─── CallTool(ssh_connect) ──────────> │
  │   { host, username, password }        │
  │                                       │ new Client().connect(sshConfig)
  │                                       │ 等待 'ready' 事件
  │                                       │ connections.set(id, {conn, config})
  │ <──────── CallToolResult ─────────── │
  │   { connectionId: "ssh-123456" }      │
```

### 2.3 命令执行阶段

```
Client                                  Server
  │ ─── CallTool(ssh_exec) ─────────────> │
  │   { connectionId, command, timeout? } │
  │                                       │ evaluateCommandTimeout(command)
  │                                       │ conn.exec(command, callback)
  │                                       │ 收集 stdout/stderr
  │                                       │ stream.on('close', (code, signal))
  │ <──────── CallToolResult ─────────── │
  │   { text: "Command: ...\nExit: 0\n" } │
```

### 2.4 文件传输阶段

```
Client                                  Server
  │ ─── CallTool(ssh_upload_file) ──────> │
  │   { connectionId, localPath,          │
  │     remotePath }                      │ conn.sftp() → fastPut()
  │                                       │
  │ <──────── CallToolResult ─────────── │
  │   { text: "Uploaded successfully" }   │
```

## 3. 串口交互数据流

### 3.1 串口连接建立

```
Client                                  Server
  │ ─── CallTool(serial_connect) ───────> │
  │   { port: "/dev/ttyUSB0" }            │ new RealSerialPort(port, options)
  │                                       │ serialPort.open()
  │                                       │ 发送 \r\n 唤醒设备
  │                                       │ 读取初始响应，检测 prompt
  │                                       │ serialConnections.set(id, {...})
  │ <──────── CallToolResult ─────────── │
  │   { text: "Connected... Mode: user" } │
```

### 3.2 串口命令发送

```
Server (RealSerialPort)
  │
  ├─ sendCommand("show version", 15000)
  │   ├─ write("show version\r\n")
  │   ├─ read(5000) → 等待数据
  │   │   ├─ serialPort.on('data') 累积到 buffer
  │   │   └─ hasCompleteResponse() 检查 prompt
  │   ├─ 若检测到 --More--，write(" ") 继续
  │   └─ 直到收到 user/enable/config prompt
  │
  └─ 返回完整响应文本
```

### 3.3 模式状态机

串口设备存在三层模式，模块内部通过 `currentMode` 追踪：

```
┌──────────┐    enable     ┌──────────┐   configure    ┌──────────┐
│   user   │ ────────────► │  enable  │ ─────────────► │  config  │
│   >      │               │    #     │                │  (...)#  │
└──────────┘               └──────────┘                └──────────┘
     ▲                          │                           │
     └──────────────────────────┴───────────────────────────┘
              exit 命令逐级退出
```

`serial_enter_enable`：发送 `enable` → 如需密码则发送 → 检查 `#` prompt  
`serial_enter_config`：需先处于 enable 模式 → 发送 `configure terminal` → 检查 `(config)#` prompt  
`serial_exit_mode`：发送 `exit` → 模式回退一级

## 4. 交换机 SSH 配置工作流

### 4.1 完整迁移流程（console_to_ssh_transition）

```
串口连接
  │
  ├─ serial_connect(port)           → RealSerialPort 打开
  ├─ serial_discover_device()       → 发送 show version，解析设备类型
  ├─ serial_enter_enable()          → 进入特权模式
  │
  ├─ switch_verify_ssh_status()
  │   ├─ show ip ssh               → 检查 SSH 版本和状态
  │   ├─ show crypto key mypubkey  → 检查 RSA 密钥
  │   ├─ show running-config | section line vty → 检查 VTY 配置
  │   └─ show ip interface brief   → 检查接口 IP
  │
  ├─ switch_apply_ssh_config()
  │   ├─ 选择模板 (cisco/aruba × basic/secure)
  │   ├─ replaceTemplateVariables() → 填充 IP/网关/用户名/密码
  │   ├─ 逐条通过串口发送命令
  │   │   └─ crypto key generate 特殊处理（90s 超时）
  │   └─ 统计成功/失败命令数
  │
  ├─ sleep(30s)                     → 等待 SSH 服务启动
  ├─ switch_test_ssh_connection()
  │   ├─ new Client() 独立连接测试
  │   └─ 执行 show version 验证
  ├─ serial_disconnect()            → 关闭串口
  │
  └─ 返回迁移报告（成功/部分成功 + 故障排查指南）
```

## 5. 固件升级数据流

```
Client                        Server                                    Switch
  │                              │                                          │
  │ CallTool(switch_upload)      │                                          │
  │─────────────────────────────>│ conn.sftp() → fastPut()                  │
  │                              │─────────────────────────────────────────>│
  │                              │ 30 min 超时，大文件传输                   │
  │                              │◄─────────────────────────────────────────│
  │                              │ dir flash:/filename 验证                 │
  │ CallTool(switch_verify)      │                                          │
  │─────────────────────────────>│ verify /md5 flash:/firmware.bin          │
  │                              │─────────────────────────────────────────>│
  │                              │◄─────────────────────────────────────────│
  │ CallTool(switch_install)     │ boot system flash:/firmware.bin          │
  │─────────────────────────────>│ copy running-config startup-config       │
  │                              │─────────────────────────────────────────>│
  │                              │ (optional) reload                        │
  │                              │─────────────────────────────────────────>│
  │                              │ Connection dropped                       │
```

## 6. 超时与并发模型

### 6.1 超时层级

| 层级 | 超时名称 | 默认值 | 说明 |
|------|----------|--------|------|
| SSH 连接 | readyTimeout | 30s | TCP + SSH 握手 |
| SSH 连接 | keepaliveInterval | 30s | 心跳发送间隔 |
| SSH 连接 | keepaliveCountMax | 3 | 容忍丢失心跳数 |
| 命令执行 | evaluateCommandTimeout | 动态 | 基于命令类型 |
| 命令执行 | userTimeout | 无 | 用户显式指定 |
| 固件上传 | uploadTimeout | 30min | SFTP 大文件 |
| 串口命令 | timeout | 10s | 单次响应等待 |
| 串口 key gen | timeout | 90s | RSA 密钥生成 |

### 6.2 并发特性

当前实现是 **单线程事件循环**（Node.js 特性），所有操作通过 Promise 顺序化：

- 同一连接上的命令**串行执行**（ssh2 exec 是并发的，但这里用 await 串行化）
- 不同连接之间**互不干扰**（独立的 ssh2 Client 实例）
- 串口连接**独占式**：同一时间一个串口只能有一个 RealSerialPort 实例

**无连接池、无并发控制、无命令队列。** 如果 AI 同时发起两个 `ssh_exec`，它们会同时通过 `conn.exec()` 下发，结果取决于 ssh2 的内部调度。
