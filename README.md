# MCP SSH Server

A Model Context Protocol (MCP) server that provides comprehensive SSH and serial console access to remote servers and network devices. Enables AI tools like Claude Desktop to securely manage Linux servers, network switches, and infrastructure devices through both network SSH connections and direct USB-to-Serial console access.

## Features

### Core SSH Capabilities
- SSH connection management with password or key-based authentication
- Remote command execution with timeout handling
- File upload and download via SFTP
- Directory listing and file operations
- Secure connection handling

### Network Device Management
- **USB-to-Serial Console Access** - Direct console connections via FTDI and other USB adapters
- **Network Switch Management** - Full support for Cisco IOS/IOS-XE and Aruba switches
- **Device Discovery** - Automatic detection of switch types and capabilities
- **Configuration Management** - Backup, restore, and automated configuration
- **Network Diagnostics** - Built-in ping, traceroute, and connectivity testing
- **Console-to-SSH Transition** - Automated SSH setup via console connection
- **Firmware Management** - Upload, verify, install, and rollback switch firmware

### Server Management
- Ubuntu server management tools (Nginx, SSL, packages, firewall)
- Compatible with Claude Desktop, VS Code, and other MCP-compatible clients

## Real-World Production Testing

This tool has been extensively tested in production network environments:

- **Network Discovery** - Successfully discovered previously unknown fluttering ports on production switches that were causing intermittent connectivity issues
- **Zero Downtime** - Managed multiple switches in live production networks without causing any network disruptions or outages
- **Time Savings** - Automated SSH configuration reduced switch setup time from 15-20 minutes to under 2 minutes
- **Reliability** - Zero incidents during production deployments across multiple network devices
- **USB-to-Serial Compatibility** - Tested with FTDI FT232R/FT232H, Prolific PL2303, Silicon Labs CP2102/CP2104, and CH340 adapters
- **Switch Compatibility** - Validated on Cisco Catalyst 2960/3560/3750 and Aruba 2530/2930 series switches

The tool has proven itself reliable enough for production network management tasks without requiring a separate lab environment for testing.

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Compatible with Windows, macOS, and Linux

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/mcp-ssh-server.git
   cd mcp-ssh-server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Install globally (optional):**
   ```bash
   npm install -g .
   ```

## Configuration

### Claude Desktop Configuration

1. Open Claude Desktop
2. Go to Settings > Developer (or press Ctrl+Shift+D)
3. Edit the MCP configuration
4. Add the following configuration:

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "node",
      "args": ["/path/to/mcp-ssh-server/build/index.js"],
      "env": {
        "NODE_NO_WARNINGS": "1"
      }
    }
  }
}
```

**Important:** Replace `/path/to/mcp-ssh-server/build/index.js` with the absolute path to your built index.js file.

### VS Code Configuration (if using MCP extension)

Create or edit `.vscode/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "node",
      "args": ["/path/to/mcp-ssh-server/build/index.js"]
    }
  }
}
```

### Preset Host Configuration

You can pre-configure commonly used SSH hosts in a `hosts.json` file, allowing AI to connect by name without typing full connection details every time.

1. Create `hosts.json` in the project root (next to `package.json`):

```json
{
  "presets": {
    "prod-web": {
      "host": "203.0.113.10",
      "port": 22,
      "username": "ubuntu",
      "privateKeyPath": "~/.ssh/id_rsa"
    },
    "switch-core": {
      "host": "192.168.1.1",
      "port": 22,
      "username": "admin",
      "password": "your-password"
    }
  }
}
```

**Fields:**
- `host` (required) - Hostname or IP address
- `username` (required) - SSH username
- `port` (optional) - SSH port, defaults to 22
- `privateKeyPath` (optional) - Path to private key file for key-based auth
- `passphrase` (optional) - Passphrase for the private key
- `password` (optional) - Password for password-based auth

**Note:** Either `privateKeyPath` or `password` must be provided for each preset.

**Custom config path:** Set the `SSH_MCP_HOSTS_CONFIG` environment variable to use a different file:

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "node",
      "args": ["/path/to/mcp-ssh-server/build/index.js"],
      "env": {
        "SSH_MCP_HOSTS_CONFIG": "/path/to/my-hosts.json"
      }
    }
  }
}
```

## Available Tools

### Core SSH Tools

### ssh_connect
Establish an SSH connection to a remote server.

**Parameters:**
- `host` (required) - Hostname or IP address
- `username` (required) - SSH username  
- `password` (optional) - SSH password
- `privateKeyPath` (optional) - Path to private key file
- `passphrase` (optional) - Passphrase for private key
- `port` (optional) - SSH port (default: 22)
- `connectionId` (optional) - Unique identifier for this connection

**Returns:**
- `success` - Boolean indicating success
- `connectionId` - ID to use for subsequent commands
- `message` - Connection status message

**Example:**
```
Connect to my server at example.com using username 'admin' and password authentication
```

### ssh_exec
Execute a command on the remote server.

**Parameters:**
- `connectionId` (required) - ID from ssh_connect
- `command` (required) - Command to execute
- `cwd` (optional) - Working directory
- `timeout` (optional) - Command timeout in milliseconds (default: 60000)

**Returns:**
- `code` - Exit code
- `signal` - Signal that terminated the process (if any)
- `stdout` - Standard output
- `stderr` - Standard error

**Example:**
```
Run "ls -la /var/www/html" on the server
```

### ssh_upload_file
Upload a file to the remote server.

**Parameters:**
- `connectionId` (required) - ID from ssh_connect
- `localPath` (required) - Local file path
- `remotePath` (required) - Remote destination path

**Returns:**
- `success` - Boolean indicating success
- `message` - Upload status message

### ssh_download_file
Download a file from the remote server.

**Parameters:**
- `connectionId` (required) - ID from ssh_connect
- `remotePath` (required) - Remote file path
- `localPath` (required) - Local destination path

**Returns:**
- `success` - Boolean indicating success
- `message` - Download status message

### ssh_list_files
List files in a directory on the remote server.

**Parameters:**
- `connectionId` (required) - ID from ssh_connect
- `remotePath` (required) - Directory path to list

**Returns:**
- `files` - Array of file objects with properties:
  - `filename` - File name
  - `isDirectory` - Boolean indicating if it's a directory
  - `size` - File size
  - `lastModified` - Last modification time

### ssh_disconnect
Close an SSH connection.

**Parameters:**
- `connectionId` (required) - ID from ssh_connect

**Returns:**
- `success` - Boolean indicating success
- `message` - Disconnection status message

### ssh_list_presets
List all pre-configured SSH hosts from `hosts.json`.

**Parameters:** None

**Returns:**
- Array of preset objects with `name`, `host`, `port`, `username`, and `authType` (`key` or `password`)
- Passwords and key paths are **not** exposed for security

**Example:**
```
Show me all configured SSH presets
```

### ssh_connect_preset
Connect to a remote server using a pre-configured host preset.

**Parameters:**
- `preset` (required) - Name of the preset to use
- `host` (optional) - Override the preset hostname or IP
- `port` (optional) - Override the SSH port
- `username` (optional) - Override the SSH username
- `password` (optional) - Override or provide password authentication
- `privateKeyPath` (optional) - Override or provide private key path
- `passphrase` (optional) - Override or provide private key passphrase
- `connectionId` (optional) - Unique identifier for this connection

**Returns:** Same as `ssh_connect`

**Example:**
```
Connect to my prod-web preset
```

**Example with override:**
```
Connect to prod-web preset but use a different key at ~/.ssh/deploy_key
```

## Usage Examples with Claude

1. **Connect to your server:**
   ```
   Please connect to my VPS at example.com using username 'admin' and my SSH key at ~/.ssh/id_rsa
   ```

2. **Check server status:**
   ```
   Run the command "systemctl status nginx" to check web server status
   ```

3. **Upload a website file:**
   ```
   Upload my local file ~/websites/index.html to /var/www/html/index.html on the server
   ```

4. **List website files:**
   ```
   Show me all files in the /var/www/html directory
   ```

5. **Download a backup:**
   ```
   Download the file /var/backups/website-backup.tar.gz to my local Downloads folder
   ```

6. **Disconnect when done:**
   ```
   Please disconnect from the SSH session
   ```

### Network Switch Management Tools

#### switch_discover_device
Discover and identify network switch device type and capabilities.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `enablePassword` (optional) - Enable password for privileged mode

#### switch_show_interfaces
Show interface status and configuration on network switch.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `interfaceType` (optional) - Type of interfaces to show
- `enablePassword` (optional) - Enable password for privileged mode

#### switch_show_vlans
Show VLAN configuration and status on network switch.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `enablePassword` (optional) - Enable password for privileged mode

#### switch_backup_config
Backup switch configuration (running or startup config).

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `configType` (optional) - Type of configuration to backup
- `enablePassword` (optional) - Enable password for privileged mode

#### switch_network_diagnostics
Run network diagnostics from switch (ping, traceroute).

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `target` (required) - Target IP address or hostname
- `diagnosticType` (optional) - Type of diagnostic to run
- `enablePassword` (optional) - Enable password for privileged mode

#### switch_show_mac_table
Show MAC address table on network switch.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `vlan` (optional) - Specific VLAN to show MAC addresses for
- `enablePassword` (optional) - Enable password for privileged mode

### USB-to-Serial Console Tools

These tools enable direct console access to network devices using USB-to-Serial adapters. This is essential for initial device setup, emergency access when network connectivity is lost, or when SSH has not yet been configured.

**Supported USB-to-Serial Adapters:**
- FTDI FT232R/FT232H (recommended - most reliable)
- Prolific PL2303 (widely compatible)
- Silicon Labs CP2102/CP2104 (good performance)
- CH340/CH341 chipsets (budget-friendly option)

All adapters work with standard Cisco/Aruba console cables (RJ45 to DB9 or direct USB).

#### serial_list_ports
List available USB-to-Serial ports on the system. Automatically detects FTDI, Prolific, Silicon Labs, and CH340 adapters.

**Example:**
```
Show me all available serial ports
```

#### serial_connect
Connect to a network device via USB-to-Serial console port.

**Parameters:**
- `port` (required) - Serial port name (e.g., COM3 on Windows, /dev/ttyUSB0 on Linux)
- `baudRate` (optional) - Baud rate (default: 9600 for most switches)
- `connectionId` (optional) - Unique identifier for connection
- `deviceType` (optional) - Device type for optimal settings (cisco, aruba, generic)

**Example:**
```
Connect to my Cisco switch console on COM3
```

#### serial_send_command
Send a command to network device via serial connection.

**Parameters:**
- `connectionId` (required) - ID of an active serial connection
- `command` (required) - Command to send to device
- `waitForResponse` (optional) - Wait for device response
- `timeout` (optional) - Response timeout in milliseconds

**Example:**
```
Send "show version" command to the console connection
```

#### serial_discover_device
Discover device type and capabilities via serial connection. Automatically identifies Cisco IOS, Cisco IOS-XE, Aruba, and generic devices.

**Parameters:**
- `connectionId` (required) - ID of an active serial connection

**Example:**
```
Discover what type of device is connected
```

#### serial_list_connections
List all active serial connections.

#### serial_disconnect
Disconnect from a serial port.

**Parameters:**
- `connectionId` (required) - ID of an active serial connection

### Ubuntu Website Management Tools

The following Ubuntu server management tools are available:

- **ubuntu_nginx_control** - Web server control (start, stop, restart, status, reload, check-config)
- **ubuntu_update_packages** - System package updates with security-only option
- **ubuntu_ssl_certificate** - SSL certificate management using Let's Encrypt (issue, renew, status, list)
- **ubuntu_website_deployment** - Website deployment with automatic backup and restore
- **ubuntu_ufw_firewall** - Firewall (UFW) management (enable, disable, allow, deny, delete)

### SSH Setup & Automation Tools

These tools automate the process of configuring SSH access on network switches via console connection, enabling a smooth transition from console-only to SSH-based management.

#### switch_generate_ssh_config
Generate SSH configuration template for a network switch based on device type and security level.

**Parameters:**
- `deviceType` (optional) - Device type: cisco, aruba (auto-detected if not specified)
- `securityLevel` (optional) - Security level: basic, secure (default: basic)
- `hostname` (required) - Switch hostname
- `ip_address` (required) - Management IP address
- `subnet_mask` (optional) - Subnet mask (default: 255.255.255.0)
- `gateway` (required) - Default gateway
- `username` (required) - SSH username
- `password` (required) - SSH password

#### switch_apply_ssh_config
Apply SSH configuration to a switch via an active serial console connection.

**Parameters:**
- `serialConnectionId` (required) - ID of an active serial connection
- `deviceType` (optional) - Device type: cisco, aruba
- `hostname` (required) - Switch hostname
- `ip_address` (required) - Management IP address
- `gateway` (required) - Default gateway
- `username` (required) - SSH username
- `password` (required) - SSH password
- `confirmApply` (required) - Must be true to proceed

#### switch_verify_ssh_status
Check the current SSH configuration status on a switch via serial connection.

**Parameters:**
- `serialConnectionId` (required) - ID of an active serial connection

#### switch_test_ssh_connection
Test SSH connectivity to a newly configured switch.

**Parameters:**
- `ip_address` (required) - Switch IP address
- `username` (required) - SSH username
- `password` (required) - SSH password
- `port` (optional) - SSH port (default: 22)

#### switch_complete_ssh_setup
Complete end-to-end SSH setup workflow via console connection. This automates the entire process of configuring SSH on a switch.

**Parameters:**
- `serialConnectionId` (required) - ID of an active serial connection
- `hostname` (required) - Switch hostname
- `ip_address` (required) - Management IP address
- `gateway` (required) - Default gateway
- `username` (required) - SSH username
- `password` (required) - SSH password
- `confirmSetup` (required) - Must be true to proceed

### Console-to-SSH Transition Tools

#### console_to_ssh_transition
Complete automated workflow to transition a network switch from console-only access to SSH management. This is the recommended tool for initial switch setup.

**Parameters:**
- `port` (required) - Serial port (e.g., COM3, /dev/ttyUSB0)
- `hostname` (required) - Switch hostname
- `ip_address` (required) - Management IP address
- `gateway` (required) - Default gateway
- `username` (required) - SSH username
- `password` (required) - SSH password
- `deviceType` (optional) - Device type: cisco, aruba (auto-detected if not specified)
- `confirmTransition` (required) - Must be true to proceed

**Example:**
```
Set up SSH on my Cisco switch connected to COM3 with hostname "switch-core-01", IP 192.168.1.10, gateway 192.168.1.1, username "admin"
```

#### quick_ssh_check
Quick check of SSH status on a switch via serial connection without making any changes.

**Parameters:**
- `port` (required) - Serial port
- `baudRate` (optional) - Baud rate (default: 9600)
- `enablePassword` (optional) - Enable password if required

### Firmware Management Tools

These tools provide comprehensive firmware management capabilities for network switches, including version checking, firmware upload, verification, installation, and rollback preparation.

#### switch_check_firmware
Check the current firmware version and system information on a network switch.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `enablePassword` (optional) - Enable password for privileged mode

**Returns:**
- Current firmware version
- Boot version
- Device model and serial number
- System uptime
- Full version output

#### switch_check_storage
Verify available storage space on the switch before firmware upload.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `enablePassword` (optional) - Enable password for privileged mode

**Returns:**
- Flash storage information
- Available space
- File system details

#### switch_upload_firmware
Upload a firmware file to the network switch via SFTP. Supports large firmware files with 30-minute timeout.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `localFirmwarePath` (required) - Local path to firmware file
- `remotePath` (optional) - Remote path on switch (default: flash:/filename)
- `enablePassword` (optional) - Enable password for privileged mode

**Example:**
```
Upload firmware file ~/downloads/c2960-lanbasek9-mz.150-2.SE11.bin to the switch
```

#### switch_verify_firmware
Verify the integrity of an uploaded firmware file on the switch using MD5 checksums.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `firmwarePath` (required) - Path to firmware file on switch
- `enablePassword` (optional) - Enable password for privileged mode

**Returns:**
- Verification status
- MD5 checksum results
- File information

#### switch_install_firmware
Install firmware on the switch and optionally reboot to apply the update.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `firmwarePath` (required) - Path to firmware file on switch
- `enablePassword` (optional) - Enable password for privileged mode
- `autoReboot` (optional) - Automatically reboot after installation (default: false)

**Important:** This modifies the boot configuration. Test in a lab environment first!

**Example:**
```
Install firmware flash:/c2960-lanbasek9-mz.150-2.SE11.bin and reboot the switch
```

#### switch_prepare_rollback
Prepare information needed for firmware rollback in case of issues with new firmware.

**Parameters:**
- `connectionId` (required) - ID of an active SSH connection
- `enablePassword` (optional) - Enable password for privileged mode

**Returns:**
- Current boot configuration
- Available firmware images
- Rollback instructions

## USB-to-Serial Console Setup

### Hardware Requirements

**USB-to-Serial Adapters:**
- FTDI-based adapters (FT232R, FT232H) - Best choice for reliability
- Prolific PL2303 - Widely available and compatible
- Silicon Labs CP2102/CP2104 - Good performance and stability
- CH340/CH341 - Budget option, works well on most systems

**Console Cables:**
- Cisco console cable (RJ45 to DB9 or USB)
- Aruba/HP console cable (RJ45 to DB9 or USB)
- Universal console cables work with most devices

### Driver Installation

**Windows:**
- FTDI drivers: Usually auto-installed, or download from ftdichip.com
- Prolific drivers: Available from prolific.com.tw
- Silicon Labs drivers: Download from silabs.com
- CH340 drivers: Usually included in Windows 10/11, or download separately

**macOS:**
- FTDI adapters: Usually work out-of-the-box
- Other adapters: May require driver installation from manufacturer

**Linux:**
- Most adapters work immediately with kernel drivers
- FTDI, Silicon Labs, CH340: Built into kernel
- Check `dmesg` after plugging in adapter to verify detection

### Quick Start with Console

1. Connect USB-to-Serial adapter to your computer
2. Connect console cable from adapter to switch console port
3. List available ports: "Show me available serial ports"
4. Connect to port: "Connect to COM3 for Cisco switch"
5. Send commands or run automated setup

## Security Notes

- Store SSH private keys securely
- Use key-based authentication when possible
- Limit SSH access to specific IP addresses
- Keep your server updated
- Use strong passwords or passphrases (minimum 8 characters)
- Secure physical access to console ports and USB-to-Serial adapters
- Consider setting up environment variables in a `.env` file for sensitive information

## Troubleshooting

### Server won't start
- Check that Node.js is installed: `node --version`
- Verify all dependencies are installed: `npm install`
- Rebuild the project: `npm run build`

### Connection issues
- Verify SSH server is running on the target
- Check firewall settings
- Confirm credentials are correct
- Test SSH connection manually first

### Claude Desktop integration
- Ensure the path in configuration is absolute
- Restart Claude Desktop after configuration changes
- Check Developer Console for error messages

## Development

To modify or extend the server:

1. Edit source files in `src/`
2. Rebuild: `npm run build`
3. Test your changes
4. Restart Claude Desktop or VS Code to pick up changes

### Running in Development Mode

For quick testing during development:

```bash
npm run dev
```

## Contributing

Contributions for additional tools and features are welcome. Please feel free to submit pull requests or open issues for enhancements and bug fixes.

## License

MIT License