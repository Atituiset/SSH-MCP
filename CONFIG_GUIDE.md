# SSH-MCP 配置指南

## 概述

SSH-MCP 支持通过**预设主机配置**来简化 SSH 连接。预定义常用服务器的连接信息后，只需引用预设名称即可连接，无需每次输入完整参数。

**配置文件支持热加载**——修改并保存配置文件后，Server 会自动重新加载，无需重启。

---

## 配置方式（按优先级）

Server 按以下优先级查找配置文件，找到第一个即停止：

| 优先级 | 路径 | 适用场景 |
|--------|------|----------|
| 1 | `SSH_MCP_HOSTS_CONFIG` 环境变量 | 临时指定自定义路径 |
| 2 | `~/.ssh-mcp.json` | **推荐**，用户级全局配置 |
| 3 | `./hosts.json` | 项目级配置（遗留兼容） |

### 方式一：用户级配置（推荐）

在 Home 目录创建 `~/.ssh-mcp.json`：

```bash
cat > ~/.ssh-mcp.json << 'EOF'
{
  "presets": {
    "my-vps": {
      "host": "203.0.113.10",
      "port": 22,
      "username": "ubuntu",
      "privateKeyPath": "~/.ssh/id_rsa"
    },
    "company-bastion": {
      "host": "bastion.example.com",
      "port": 2222,
      "username": "admin",
      "password": "your-password-here"
    }
  }
}
EOF
```

优点：一个文件管所有主机，跟随用户账号，跨项目通用。

### 方式二：项目级配置

在当前工作目录创建 `hosts.json`：

```json
{
  "presets": {
    "local-vm": {
      "host": "192.168.56.101",
      "username": "vagrant",
      "privateKeyPath": "~/.vagrant.d/insecure_private_key"
    }
  }
}
```

适用场景：项目相关的临时测试环境，只想在该项目目录生效。

### 方式三：环境变量指定路径

```bash
export SSH_MCP_HOSTS_CONFIG=/path/to/my-config.json
```

Claude Desktop 中通过 `env` 字段设置：

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "node",
      "args": ["/path/to/build/index.js"],
      "env": {
        "SSH_MCP_HOSTS_CONFIG": "/path/to/my-config.json"
      }
    }
  }
}
```

---

## 配置文件格式

```json
{
  "presets": {
    "<预设名称>": {
      "host": "<IP 或域名>",
      "port": 22,
      "username": "<用户名>",
      "password": "<密码>",
      "privateKeyPath": "<私钥路径>",
      "passphrase": "<密钥口令>"
    }
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `host` | 是 | 服务器 IP 或域名 |
| `username` | 是 | SSH 登录用户名 |
| `port` | 否 | SSH 端口，默认 `22` |
| `password` | 条件 | 密码认证时必填（与 `privateKeyPath` 二选一） |
| `privateKeyPath` | 条件 | 密钥认证时必填（与 `password` 二选一） |
| `passphrase` | 否 | 私钥解密口令 |

`privateKeyPath` 中的 `~` 会自动展开为 Home 目录。

---

## 使用预设连接

### 列出所有预设

```
ssh_list_presets
```

输出示例：
```
Configured SSH presets:

[
  { "name": "my-vps", "host": "203.0.113.10", "port": 22, "username": "ubuntu", "authType": "key" },
  { "name": "company-bastion", "host": "bastion.example.com", "port": 2222, "username": "admin", "authType": "password" }
]
```

### 使用预设连接

```
ssh_connect
- preset: my-vps
- connectionId: vps-01
```

### 覆盖预设字段

```
ssh_connect
- preset: my-vps
- username: root
- connectionId: vps-root
```

---

## 热加载

Server 启动后会持续监视配置文件。保存修改后约 **1.3 秒内**自动生效（1 秒轮询 + 300ms 防抖）。

### 观察热加载日志

修改并保存配置文件后，Claude Desktop 的 Developer Console 或终端会看到：

```
Config file changed, reloading presets...
Reloaded 3 SSH preset(s) from /home/<user>/.ssh-mcp.json
```

### 热加载的行为规则

| 场景 | 行为 |
|------|------|
| 正常修改 | 新配置立即生效 |
| 保存了语法错误的 JSON | **保留旧配置**，打印错误，不影响现有连接 |
| 删除配置文件 | **保留旧配置**，打印警告 |
| 已有 SSH 连接 | 不受影响，热加载只影响新连接 |

---

## 故障排查

### 预设未加载

启动时检查控制台输出：

```
Loaded 3 SSH preset(s) from /home/<user>/.ssh-mcp.json
```

如果看到：
```
No hosts config found. Expected one of:
  - /home/<user>/.ssh-mcp.json (recommended)
  - /path/to/cwd/hosts.json (legacy)
```

检查文件是否存在且格式正确。

### 热加载未生效

1. 确认修改的是当前生效的文件（检查优先级）
2. 查看 Developer Console 是否有 `Config file changed` 日志
3. 若 JSON 语法错误，日志会显示 `Failed to reload presets`，旧配置仍保留

### 认证失败

- 确认 `host` 和 `port` 可达
- 密码认证：确认密码正确
- 密钥认证：确认 `privateKeyPath` 指向私钥文件（不是 `.pub`）
- 密钥有口令：必须配置 `passphrase`

### 权限问题

```bash
chmod 600 ~/.ssh/id_rsa
chmod 600 ~/.ssh-mcp.json
```

---

## 安全建议

1. **优先使用密钥认证**
2. **配置文件设权限**：`chmod 600 ~/.ssh-mcp.json`
3. **不要提交到 Git**：`.gitignore` 中添加 `hosts.json` 和 `.ssh-mcp.json`
