# SSH-MCP 配置指南

## 概述

SSH-MCP 支持通过**预设主机配置**来简化 SSH 连接。你可以预定义常用服务器的连接信息，之后只需引用预设名称即可连接，无需每次都输入完整的 host、username、密码或密钥路径。

---

## 配置方式（按优先级）

配置文件的查找优先级如下（高优先级覆盖低优先级）：

| 优先级 | 方式 | 适用场景 |
|--------|------|----------|
| 1 | `SSH_MCP_HOSTS_CONFIG` 环境变量 | 临时指定自定义路径 |
| 2 | `~/.ssh-mcp.json` | **推荐**，用户级全局配置 |
| 3 | `./hosts.json` | 项目级配置（向后兼容） |

---

## 方式一：用户级配置（推荐）

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
    },
    "staging-server": {
      "host": "10.0.1.50",
      "username": "deploy",
      "privateKeyPath": "~/.ssh/staging_key",
      "passphrase": "key-passphrase"
    }
  }
}
EOF
```

**优点：**
- 一个文件管理所有常用主机
- 跟随用户账号，切换项目目录无需重复配置
- 符合 `~/.ssh/config` 的惯例

---

## 方式二：项目级配置（遗留）

在当前工作目录创建 `hosts.json`：

```bash
cat > hosts.json << 'EOF'
{
  "presets": {
    "local-vm": {
      "host": "192.168.56.101",
      "username": "vagrant",
      "privateKeyPath": "~/.vagrant.d/insecure_private_key"
    }
  }
}
EOF
```

**适用场景：** 项目相关的临时测试环境，只想在该项目目录生效。

---

## 方式三：环境变量指定路径

```bash
export SSH_MCP_HOSTS_CONFIG=/path/to/my-config.json
npm start
```

---

## 配置文件格式

### 完整字段说明

```json
{
  "presets": {
    "<preset-name>": {
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
| `host` | 是 | 服务器 IP 地址或域名 |
| `username` | 是 | SSH 登录用户名 |
| `port` | 否 | SSH 端口，默认 `22` |
| `password` | 条件 | 密码认证时必须（与 `privateKeyPath` 二选一） |
| `privateKeyPath` | 条件 | 密钥认证时必须（与 `password` 二选一） |
| `passphrase` | 否 | 私钥的解密口令 |

**注意：** 每个预设至少需要配置 `password` 或 `privateKeyPath` 其中一种认证方式。

### 密钥路径中的 `~`

`privateKeyPath` 支持 `~` 展开为当前用户的 Home 目录：

```json
"privateKeyPath": "~/.ssh/id_rsa"
```

会被自动解析为 `/home/<user>/.ssh/id_rsa`（Linux/macOS）或 `C:\Users\<user>\.ssh\id_rsa`（Windows）。

---

## 使用预设连接

### 1. 列出所有预设

```
ssh_list_presets
```

输出示例：
```
Configured SSH presets:

[
  {
    "name": "my-vps",
    "host": "203.0.113.10",
    "port": 22,
    "username": "ubuntu",
    "authType": "key"
  },
  {
    "name": "company-bastion",
    "host": "bastion.example.com",
    "port": 2222,
    "username": "admin",
    "authType": "password"
  }
]
```

### 2. 使用预设连接

```
ssh_connect_preset
- preset: my-vps
- connectionId: vps-01
```

### 3. 覆盖预设字段

连接时可以覆盖任意字段：

```
ssh_connect_preset
- preset: my-vps
- username: root
- connectionId: vps-root
```

```
ssh_connect_preset
- preset: company-bastion
- host: backup-bastion.example.com
- connectionId: backup-bastion
```

### 4. 执行命令

```
ssh_exec
- connectionId: vps-01
- command: uname -a
```

---

## 完整工作流程示例

```
# 1. 查看可用预设
ssh_list_presets

# 2. 连接到预设主机
ssh_connect_preset
  preset: my-vps
  connectionId: prod-01

# 3. 执行命令（超时自动识别为 60 秒）
ssh_exec
  connectionId: prod-01
  command: ls -la /var/log

# 4. 上传文件
ssh_upload_file
  connectionId: prod-01
  localPath: ./app.tar.gz
  remotePath: /tmp/app.tar.gz

# 5. 断开连接
ssh_disconnect
  connectionId: prod-01
```

---

## 故障排查

### 预设未加载

启动时观察控制台输出：

```
Loaded 3 SSH preset(s) from /home/<user>/.ssh-mcp.json
```

如果看到：
```
No hosts config found. Expected one of:
  - /home/<user>/.ssh-mcp.json (recommended)
  - /path/to/cwd/hosts.json (legacy)
```

请检查文件是否存在且格式正确。

### 认证失败

- 确认 `host` 和 `port` 可达
- 密码认证：确认密码正确
- 密钥认证：确认 `privateKeyPath` 指向正确的私钥文件（不是 `.pub` 公钥）
- 密钥有口令：必须配置 `passphrase` 字段

### 权限问题

```bash
# 确保私钥权限正确
chmod 600 ~/.ssh/id_rsa
```

---

## 安全建议

1. **优先使用密钥认证**：将 `privateKeyPath` 代替 `password`
2. **保护配置文件**：设置适当的文件权限
   ```bash
   chmod 600 ~/.ssh-mcp.json
   ```
3. **不要将配置文件提交到 Git**：在 `.gitignore` 中添加：
   ```
   hosts.json
   .ssh-mcp.json
   ```
4. **密钥口令**：如果私钥设置了 `passphrase`，可在配置中填写，或连接时通过覆盖参数传入
