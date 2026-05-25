# 模块源码深入分析

## 1. index.ts — 核心引擎

### 1.1 SSH 连接建立流程

```
handleSSHConnect(params)
  ├─ 验证：password 和 privateKeyPath 至少提供一个
  ├─ 构建 sshConfig
  │   ├─ 基础参数：host, port, username
  │   ├─ readyTimeout: 30000 (连接建立超时)
  │   ├─ keepaliveInterval: 30000 (心跳间隔)
  │   ├─ keepaliveCountMax: 3 (最大容忍丢失心跳数)
  │   └─ 认证：privateKey (支持 ~ 展开) 或 password
  ├─ new Client() → connect(sshConfig)
  ├─ Promise 封装 ready/error 事件
  └─ 存入 connections Map，返回 connectionId
```

**Tilde 展开处理：** `privateKeyPath.replace(/^~/, os.homedir())` 和 `localPath.replace(/^~/, os.homedir())` 在多处重复出现，属于可提取的公共工具函数。

### 1.2 命令执行 `handleSSHExec`

```
handleSSHExec(params)
  ├─ evaluateCommandTimeout(command, userTimeout) → timeout
  ├─ 从 Map 取出 conn
  ├─ conn.exec(command, { cwd? }, callback)
  │   ├─ stream.on('data') → stdout
  │   ├─ stream.stderr.on('data') → stderr
  │   └─ stream.on('close', (code, signal)) → resolve
  ├─ setTimeout 拒绝长时间无响应
  └─ 格式化返回：Command + Exit code + Output
```

**注意：** 命令超时不会自动 kill 远程进程。超时后 Promise reject，但 ssh2 的 exec stream 仍在服务器端运行。这是 `ssh2` 库的设计，不是 bug。

### 1.3 SFTP 文件操作

`handleSSHUpload` / `handleSSHDownload` / `handleSSHListFiles` 共用同一套 SFTP 初始化模式：

```typescript
const sftp = await new Promise((resolve, reject) => {
  conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
});
```

上传使用 `sftp.fastPut()`（并行传输，适合大文件），下载使用 `sftp.fastGet()`，列表使用 `sftp.readdir()`。

文件属性解析：`(file.attrs.mode & 16384) === 16384` 判断目录（16384 = 0o40000 = S_IFDIR）。

---

## 2. ubuntu-website-tools.ts — Ubuntu 服务器管理

### 2.1 工具列表

| 工具 | 能力 | 超时 |
|------|------|------|
| `ubuntu_nginx_control` | systemctl + nginx -t | 默认 60s |
| `ubuntu_update_packages` | apt-get update/upgrade/autoremove | 5 min |
| `ubuntu_ssl_certificate` | certbot 自动安装与管理 | 默认 60s |
| `ubuntu_website_deployment` | 部署/备份/恢复网站文件 | 默认 60s |
| `ubuntu_ufw_firewall` | UFW 防火墙规则管理 | 默认 60s |

### 2.2 架构问题：ListTools 处理器覆盖

```typescript
// Line 683: 完全替换已有的 ListTools 处理器
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // 核心 SSH 工具的完整复制（硬编码）
    { name: 'ssh_connect', ... },
    ...
    // Ubuntu 工具
    ...ubuntuTools
  ]
}));
```

这导致：
1. 其他模块注册的工具（network-switch, serial 等）**不会出现在工具列表中**
2. 如果调整核心工具参数，必须同步修改两处（`index.ts` + `ubuntu-website-tools.ts`）
3. 实际上 `addUbuntuTools` 被 `index.ts:179` 调用，而 `addNetworkSwitchTools` 等虽然被 `index.ts` 中引用了函数，但实际上并没有在构造函数中调用（源码中并未看到 addNetworkSwitchTools 的调用）

### 2.3 部署工具的设计

`ubuntu_website_deployment` 支持三种 action：
- **deploy**: 自动创建 tar.gz 备份 → 上传文件/目录 → 修复 www-data 权限
- **backup**: 生成带时间戳的 tar.gz
- **restore**: 从备份恢复

目录部署使用本地 zip + SFTP 上传 + 远程 unzip 的三步策略。但存在一个明显问题：

```typescript
// Line 331
await executeSSHCommand(conn, `zip -r ${tempZipFile} ${expandedLocalPath}`);
```

这尝试在**远程服务器上** zip 本地路径，逻辑是错误的。应该使用本地 `child_process` 或 `adm-zip` 等库在本地打包。

---

## 3. network-switch-tools.ts — 交换机 SSH 管理

### 3.1 设备抽象模型

```typescript
interface NetworkDevice {
  id: string;
  type: 'cisco-ios' | 'cisco-ios-xe' | 'aruba-switch' | 'generic';
  connectionType: 'ssh' | 'serial';
  // ...
}
```

### 3.2 命令映射表

`SwitchCommands` 对象提供了 Cisco 和 Aruba 的命令映射：

```typescript
SwitchCommands = {
  cisco: { showVersion, showRunningConfig, showInterfaces, ... },
  aruba: { showVersion, showRunningConfig, showInterfaces, ... }
}
```

每个工具的实现流程高度一致：
1. `getConnection()` 获取 ssh2 Client
2. `executeNetworkCommand(conn, 'show version', 'generic')` 自动发现设备类型
3. 选择对应 `SwitchCommands` 分支
4. 执行目标命令
5. 用 `parseInterfaceStatus()` / `parseVlanInfo()` 解析输出

### 3.3 输出解析器

**Cisco 接口状态解析：** 匹配 `Gi/Te/Fa/Et` 前缀的接口行，按空白分割：
```
Gi1/0/1  connected  1    a-full  a-1000  10/100/1000BaseTX
name     status     vlan duplex  speed   type
```

**Aruba 接口状态解析：** 匹配数字开头的行：
```
1      100/1000T  Yes    Up     1000FDx  MDI
port   type       enabled status speed   duplex
```

解析器使用简单的正则 + split，对非标输出鲁棒性有限。

---

## 4. serial-connection-tools.ts — USB-to-Serial 控制台

### 4.1 RealSerialPort 类

封装 `serialport` 库的底层操作，提供高层抽象：

```typescript
class RealSerialPort {
  private serialPort: SerialPort;      // 底层串口实例
  private parser: ReadlineParser;       // \r\n 分隔的流式解析器
  private buffer: string = '';          // 响应累积缓冲区
  private dataPromiseResolve: ...;     // read() 的异步等待器
}
```

**核心方法：**
- `open()`: 打开串口
- `write(data)`: 写入并 drain
- `read(timeout)`: 等待直到收到完整 prompt 或超时
- `sendCommand(command, timeout)`: write + read 循环，自动处理 `--More--` 分页
- `readUntil(pattern, timeout)`: 读取直到匹配正则

### 4.2 Prompt 检测模式

```typescript
PROMPT_PATTERNS = {
  user:     /^[\w\-]+>\s*$/m,           // Switch>
  enable:   /^[\w\-]+#\s*$/m,           // Switch#
  config:   /^[\w\-]+\([^\)]+\)#\s*$/m, // Switch(config)#
  password: /[Pp]assword:\s*$/m,
  morePrompt: /--[Mm]ore--/,
  confirm:  /\[yes\/no\]|\[confirm\]|\(y\/n\)/i
}
```

`hasCompleteResponse()` 检查缓冲区是否以任一 prompt 结尾，用于判断响应是否完整。

### 4.3 `--More--` 分页处理

`sendCommand()` 中的关键逻辑：

```typescript
if (PROMPT_PATTERNS.morePrompt.test(response)) {
  await this.write(' ');  // 发送空格继续输出
  continue;
}
```

这对 Cisco/Aruba 的长输出（如 `show running-config`）至关重要。

### 4.4 串口连接状态追踪

```typescript
interface SerialConnection {
  id, port, baudRate, ...           // 基础配置
  deviceType?: string;              // 自动发现结果
  currentMode?: 'user'|'enable'|'config'|'unknown';
  lastPrompt?: string;              // 最后检测到的 prompt
  lastActivity?: Date;              // 最后交互时间
}
```

---

## 5. ssh-setup-tools.ts — SSH 配置自动化

### 5.1 配置模板系统

```typescript
SSHConfigTemplates = {
  cisco: {
    basic: [...],   // 2048-bit RSA, 标准超时
    secure: [...]   // 4096-bit RSA, exec-timeout, banner, no http
  },
  aruba: {
    basic: [...],
    secure: [...]
  }
}
```

模板使用 `{variable}` 占位符，通过 `replaceTemplateVariables()` 进行字符串替换。

### 5.2 配置验证器

```typescript
validateNetworkConfig(config): { valid, errors }
  - IP 地址格式验证（简单四段数字）
  - 子网掩码格式验证
  - 网关格式验证
  - username >= 3 字符
  - password >= 8 字符
  - hostname >= 3 字符
```

注意：IP 验证正则 `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$` 并不校验数值范围（如 999.999.999.999 会通过）。

### 5.3 配置应用流程

`switch_apply_ssh_config` 通过串口逐条发送命令：

```
进入 enable 模式
  ├─ 发送 'enable'
  ├─ 如需密码，自动填入 enable_password
  └─ 确认 prompt 变为 #

逐条发送配置命令
  ├─ 特殊处理 crypto key generate（90s 超时）
  ├─ 检查响应中的 invalid/error/failed/unknown command
  ├─ 成功/失败计数
  └─ 命令间 500ms 延迟

返回状态报告
```

---

## 6. console-transition-tools.ts — 端到端迁移工作流

### 6.1 编排式架构

此模块不直接操作硬件，而是**编排** serial-connection-tools 和 ssh-setup-tools 的调用：

```
console_to_ssh_transition(params)
  ├─ 验证网络配置
  ├─ 确认提示（confirmTransition）
  ├─ serial_connect()           → 串口连接
  ├─ serial_discover_device()   → 设备发现
  ├─ serial_enter_enable()      → 进入特权模式
  ├─ switch_verify_ssh_status() → 检查当前 SSH 状态
  ├─ switch_apply_ssh_config()  → 应用 SSH 配置
  ├─ 等待 30s（服务启动）
  ├─ switch_test_ssh_connection() → SSH 连通性测试
  ├─ serial_disconnect()        → 断开串口
  └─ 返回迁移报告
```

### 6.2 错误恢复策略

当前实现采用 **尽力而为** 策略：
- 串口连接失败 → 直接抛错终止
- enable 模式失败 → 告警但继续
- SSH 配置应用失败 → 记录为 PARTIAL SUCCESS
- SSH 测试失败 → 提供故障排查指南

---

## 7. switch-firmware-tools.ts — 固件生命周期管理

### 7.1 固件操作管道

```
switch_check_firmware()     → 解析 show version 提取版本/型号/序列号
      ↓
switch_check_storage()      → 尝试多个存储查看命令
      ↓
switch_upload_firmware()    → SFTP fastPut，30 分钟超时
      ↓
switch_verify_firmware()    → verify / verify /md5 / show file info
      ↓
switch_install_firmware()   → 设置 boot system + write mem (+ optional reload)
      ↓
switch_prepare_rollback()   → 收集当前 boot 配置和可用镜像
```

### 7.2 设备类型自适应

安装命令根据 `show version` 输出自动区分 Cisco/Aruba：

| 设备 | Boot 设置命令 | 保存命令 |
|------|--------------|----------|
| Cisco | `boot system flash:<file>` | `copy running-config startup-config` |
| Aruba | `boot set-default flash:<file>` | `write memory` |

---

## 8. 代码重复分析

通过阅读全部源码，发现以下重复模式：

### 8.1 `executeSSHCommand` / `executeNetworkCommand`

三个模块各自实现了几乎相同的命令执行包装器：
- `ubuntu-website-tools.ts:18-58`
- `network-switch-tools.ts:176-221`
- `switch-firmware-tools.ts:22-65`

差异仅在于默认超时（60s / 30s / 30s）和参数签名。

### 8.2 `getConnection`

三个模块各自实现：
- `network-switch-tools.ts:224-229`
- `switch-firmware-tools.ts:14-19`
- `ubuntu-website-tools.ts:61-66`

### 8.3 SFTP 初始化代码

`index.ts` 的 upload/download 与 `switch-firmware-tools.ts` 的 upload_firmware 中的 SFTP 初始化逻辑重复。

### 8.4 Tilde 展开

`localPath.replace(/^~/, os.homedir())` 在 `index.ts`（upload/download）和 `ubuntu-website-tools.ts`（deployment）中重复出现。
