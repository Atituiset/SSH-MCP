# SSH-MCP 源码分析文档索引

本文档集是对 SSH-MCP 项目源码的深入结构分析，涵盖架构设计、模块实现、数据流和已知问题。

## 文档列表

| 编号 | 文件名 | 内容 |
|------|--------|------|
| 01 | [01-overview.md](01-overview.md) | 项目定位、技术栈、模块职责矩阵、版本演进 |
| 02 | [02-core-architecture.md](02-core-architecture.md) | SSHMCPServer 类、工具注册双轨制、超时评估、keepalive、错误模型 |
| 03 | [03-module-deep-dive.md](03-module-deep-dive.md) | 7 个源文件的逐模块源码级分析、代码重复识别 |
| 04 | [04-data-flow.md](04-data-flow.md) | MCP 协议交互序列、串口数据流、工作流编排、超时层级 |
| 05 | [05-design-decisions.md](05-design-decisions.md) | 6 个关键架构决策的 trade-off 分析 |
| 06 | [06-known-issues.md](06-known-issues.md) | 4 个 Critical/High 问题、4 个 Medium/Low 问题、改进路线图 |

## 快速导航

- **想了解整体架构？** → [01-overview.md](01-overview.md)
- **想看源码级别的模块分析？** → [03-module-deep-dive.md](03-module-deep-dive.md)
- **关心已知问题和风险？** → [06-known-issues.md](06-known-issues.md)
- **对设计决策感兴趣？** → [05-design-decisions.md](05-design-decisions.md)
