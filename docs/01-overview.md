# SSH-MCP 项目架构总览

## 1. 项目定位

SSH-MCP 是一个基于 Model Context Protocol (MCP) 的服务器实现，核心目标是让 AI 工具（如 Claude Desktop）能够通过 SSH 和 USB-to-Serial 控制台安全地连接并管理远程设备。

**支持的设备类型：**
- Linux / Ubuntu 服务器（通用 SSH）
- Cisco IOS / IOS-XE 交换机
- Aruba / HP ProCurve 交换机
- 任何支持串口控制的网络设备

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| MCP 协议 | `@modelcontextprotocol/sdk` v0.6.0 |
| SSH 连接 | `ssh2` v1.11.0 |
| 串口通信 | `serialport` v12.0.0 + `@serialport/parser-readline` |
| 运行时 | Node.js 18+ (ES2020, ESM) |
| 构建 | TypeScript 5.x |

---

## 3. 项目结构

```
SSH-MCP/
├── src/
│   ├── index.ts                    # 核心入口：SSHMCPServer 类
│   ├── ubuntu-website-tools.ts     # Ubuntu 服务器管理工具
│   ├── network-switch-tools.ts     # 网络交换机 SSH 管理
│   ├── serial-connection-tools.ts  # USB-to-Serial 控制台
│   ├── ssh-setup-tools.ts          # 交换机 SSH 配置自动化
│   ├── console-transition-tools.ts # 串口到 SSH 迁移工作流
│   └── switch-firmware-tools.ts    # 固件管理
├── build/                          # tsc 编译输出 (被 .gitignore)
├── docs/                           # 本分析文档
├── package.json
├── tsconfig.json
├── mcp.json                        # MCP 客户端配置示例
└── README.md
```

---

## 4. 模块职责矩阵

| 模块 | 连接方式 | 目标设备 | 核心能力 |
|------|----------|----------|----------|
| `index.ts` | SSH (TCP) | 通用 Linux | 连接/命令/SFTP 文件传输 |
| `ubuntu-website-tools.ts` | SSH 复用 | Ubuntu | Nginx、UFW、SSL、部署 |
| `network-switch-tools.ts` | SSH 复用 | Cisco/Aruba | 发现、接口、VLAN、诊断 |
| `serial-connection-tools.ts` | USB Serial | 任意串口设备 | 控制台连接、命令交互 |
| `ssh-setup-tools.ts` | USB Serial | Cisco/Aruba | SSH 自动化配置模板 |
| `console-transition-tools.ts` | Serial + SSH | Cisco/Aruba | 端到端迁移工作流 |
| `switch-firmware-tools.ts` | SSH 复用 | Cisco/Aruba | 固件上传/验证/安装/回滚 |

---

## 5. 版本演进

| Tag | 关键变更 |
|-----|----------|
| v1.0.0 | 初始版本，核心 SSH + 串口 + 交换机管理 |
| v1.1.0 | 新增动态命令超时评估 (`evaluateCommandTimeout`) + SSH keepalive 防断连 |
