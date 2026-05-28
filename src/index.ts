#!/usr/bin/env node

/**
 * MCP SSH Server
 * 
 * A Model Context Protocol (MCP) server that provides SSH access to remote servers.
 * This allows AI tools like Claude or VS Code to securely connect to your VPS.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from "ssh2";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as dotenv from "dotenv";
import { addUbuntuTools, ubuntuToolHandlers } from "./ubuntu-website-tools.js";

// Load environment variables from .env file if present
dotenv.config();

interface SSHPreset {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

interface HostsConfig {
  presets: Record<string, SSHPreset>;
}

class SSHMCPServer {
  private server: Server;
  private connections: Map<string, { conn: Client; config: any }>;
  private presets: Map<string, SSHPreset>;
  private configPath: string | null = null;
  private reloadDebounceTimer: NodeJS.Timeout | null = null;
  private isWatchingConfig: boolean = false;

  constructor() {
    this.connections = new Map();
    this.presets = new Map();
    this.server = new Server(
      {
        name: "MCP SSH Server",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {
            ssh_connect: {
              description: "Manually connect to a remote server via SSH with explicit host, username, and credentials. Use this ONLY when the target server has NO preset configured. The user must provide host, username, and either password or privateKeyPath. If the user mentions a server name or alias (e.g., \"connect to my-server\"), prefer ssh_connect_preset instead — the preset already contains all connection details.",
              inputSchema: {
                type: "object",
                properties: {
                  host: {
                    type: "string",
                    description: "Hostname or IP address of the remote server"
                  },
                  port: {
                    type: "number",
                    description: "SSH port (default: 22)"
                  },
                  username: {
                    type: "string",
                    description: "SSH username"
                  },
                  password: {
                    type: "string",
                    description: "SSH password (if not using key-based authentication)"
                  },
                  privateKeyPath: {
                    type: "string",
                    description: "Path to private key file (if using key-based authentication)"
                  },
                  passphrase: {
                    type: "string",
                    description: "Passphrase for private key (if needed)"
                  },
                  connectionId: {
                    type: "string",
                    description: "Unique identifier for this connection (to reference in future commands)"
                  }
                },
                required: ["host", "username"]
              }
            },
            ssh_exec: {
              description: "Execute a command on the remote server",
              inputSchema: {
                type: "object",
                properties: {
                  connectionId: {
                    type: "string",
                    description: "ID of an active SSH connection"
                  },
                  command: {
                    type: "string",
                    description: "Command to execute"
                  },
                  cwd: {
                    type: "string",
                    description: "Working directory for the command"
                  },
                  timeout: {
                    type: "number",
                    description: "Command timeout in milliseconds"
                  }
                },
                required: ["connectionId", "command"]
              }
            },
            ssh_upload_file: {
              description: "Upload a file to the remote server",
              inputSchema: {
                type: "object",
                properties: {
                  connectionId: {
                    type: "string",
                    description: "ID of an active SSH connection"
                  },
                  localPath: {
                    type: "string",
                    description: "Path to the local file"
                  },
                  remotePath: {
                    type: "string",
                    description: "Path where the file should be saved on the remote server"
                  }
                },
                required: ["connectionId", "localPath", "remotePath"]
              }
            },
            ssh_download_file: {
              description: "Download a file from the remote server",
              inputSchema: {
                type: "object",
                properties: {
                  connectionId: {
                    type: "string",
                    description: "ID of an active SSH connection"
                  },
                  remotePath: {
                    type: "string",
                    description: "Path to the file on the remote server"
                  },
                  localPath: {
                    type: "string",
                    description: "Path where the file should be saved locally"
                  }
                },
                required: ["connectionId", "remotePath", "localPath"]
              }
            },
            ssh_list_files: {
              description: "List files in a directory on the remote server",
              inputSchema: {
                type: "object",
                properties: {
                  connectionId: {
                    type: "string",
                    description: "ID of an active SSH connection"
                  },
                  remotePath: {
                    type: "string",
                    description: "Path to the directory on the remote server"
                  }
                },
                required: ["connectionId", "remotePath"]
              }
            },
            ssh_disconnect: {
              description: "Close an SSH connection",
              inputSchema: {
                type: "object",
                properties: {
                  connectionId: {
                    type: "string",
                    description: "ID of an active SSH connection"
                  }
                },
                required: ["connectionId"]
              }
            },
            ssh_list_presets: {
              description: "List all pre-configured SSH host presets from the config file (~/.ssh-mcp.json, hosts.json, or SSH_MCP_HOSTS_CONFIG). The server loads this on startup and hot-reloads when changed. Use this when the user is vague about which server to connect to (e.g., \"connect to a server\" without naming one), or after ssh_connect_preset fails with \"Unknown preset\" to discover available names. Returns preset names and metadata (auth type, host, port, username) without exposing passwords or key paths.",
              inputSchema: {
                type: "object",
                properties: {},
                required: []
              }
            },
            ssh_connect_preset: {
              description: "Connect to a remote server using a PRECONFIGURED preset from ~/.ssh-mcp.json, hosts.json, or SSH_MCP_HOSTS_CONFIG. This is the PRIMARY way to connect — presets already include host, username, and authentication (password or private key), so the user does NOT need to provide credentials again. When the user says \"connect to X\" or \"SSH into X\", X is the preset name — pass it directly as the \"preset\" parameter. If the preset does not exist, the server will return an error with available preset names. Any field can be overridden if needed.",
              inputSchema: {
                type: "object",
                properties: {
                  preset: {
                    type: "string",
                    description: "Name of the preset to use. When the user says \"connect to my-server\" or \"SSH into the prod box\", the preset name is exactly what they said (e.g., \"my-server\" or \"prod\")"
                  },
                  host: {
                    type: "string",
                    description: "Override the preset hostname or IP"
                  },
                  port: {
                    type: "number",
                    description: "Override the SSH port"
                  },
                  username: {
                    type: "string",
                    description: "Override the SSH username"
                  },
                  password: {
                    type: "string",
                    description: "Override or provide password authentication"
                  },
                  privateKeyPath: {
                    type: "string",
                    description: "Override or provide private key path"
                  },
                  passphrase: {
                    type: "string",
                    description: "Override or provide private key passphrase"
                  },
                  connectionId: {
                    type: "string",
                    description: "Unique identifier for this connection"
                  }
                },
                required: ["preset"]
              }
            }
          }
        }
      }
    );

    this.setupHandlers();

    // Add Ubuntu website management tools
    addUbuntuTools(this.server, this.connections);

    // Load preset host configurations
    this.loadPresets();
  }

  private setupHandlers() {
    // Register tool list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'ssh_connect',
          description: 'Manually connect to a remote server via SSH with explicit host, username, and credentials. Use this ONLY when the target server has NO preset configured. The user must provide host, username, and either password or privateKeyPath. If the user mentions a server name or alias (e.g., "connect to my-server"), prefer ssh_connect_preset instead — the preset already contains all connection details.',
          inputSchema: {
            type: 'object',
            properties: {
              host: { type: 'string', description: 'Hostname or IP address of the remote server' },
              port: { type: 'number', description: 'SSH port (default: 22)' },
              username: { type: 'string', description: 'SSH username' },
              password: { type: 'string', description: 'SSH password (if not using key-based authentication)' },
              privateKeyPath: { type: 'string', description: 'Path to private key file (if using key-based authentication)' },
              passphrase: { type: 'string', description: 'Passphrase for private key (if needed)' },
              connectionId: { type: 'string', description: 'Unique identifier for this connection' }
            },
            required: ['host', 'username']
          }
        },
        {
          name: 'ssh_exec',
          description: 'Execute a command on the remote server',
          inputSchema: {
            type: 'object',
            properties: {
              connectionId: { type: 'string', description: 'ID of an active SSH connection' },
              command: { type: 'string', description: 'Command to execute' },
              cwd: { type: 'string', description: 'Working directory for the command' },
              timeout: { type: 'number', description: 'Command timeout in milliseconds' }
            },
            required: ['connectionId', 'command']
          }
        },
        {
          name: 'ssh_upload_file',
          description: 'Upload a file to the remote server',
          inputSchema: {
            type: 'object',
            properties: {
              connectionId: { type: 'string', description: 'ID of an active SSH connection' },
              localPath: { type: 'string', description: 'Path to the local file' },
              remotePath: { type: 'string', description: 'Path where the file should be saved on the remote server' }
            },
            required: ['connectionId', 'localPath', 'remotePath']
          }
        },
        {
          name: 'ssh_download_file',
          description: 'Download a file from the remote server',
          inputSchema: {
            type: 'object',
            properties: {
              connectionId: { type: 'string', description: 'ID of an active SSH connection' },
              remotePath: { type: 'string', description: 'Path to the file on the remote server' },
              localPath: { type: 'string', description: 'Path where the file should be saved locally' }
            },
            required: ['connectionId', 'remotePath', 'localPath']
          }
        },
        {
          name: 'ssh_list_files',
          description: 'List files in a directory on the remote server',
          inputSchema: {
            type: 'object',
            properties: {
              connectionId: { type: 'string', description: 'ID of an active SSH connection' },
              remotePath: { type: 'string', description: 'Path to the directory on the remote server' }
            },
            required: ['connectionId', 'remotePath']
          }
        },
        {
          name: 'ssh_disconnect',
          description: 'Close an SSH connection',
          inputSchema: {
            type: 'object',
            properties: {
              connectionId: { type: 'string', description: 'ID of an active SSH connection' }
            },
            required: ['connectionId']
          }
        },
        {
          name: 'ssh_list_presets',
          description: 'List all pre-configured SSH host presets from the config file (~/.ssh-mcp.json, hosts.json, or SSH_MCP_HOSTS_CONFIG). The server loads this on startup and hot-reloads when changed. Use this when the user is vague about which server to connect to (e.g., "connect to a server" without naming one), or after ssh_connect_preset fails with "Unknown preset" to discover available names. Returns preset names and metadata (auth type, host, port, username) without exposing passwords or key paths.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'ssh_connect_preset',
          description: 'Connect to a remote server using a PRECONFIGURED preset from ~/.ssh-mcp.json, hosts.json, or SSH_MCP_HOSTS_CONFIG. This is the PRIMARY way to connect — presets already include host, username, and authentication (password or private key), so the user does NOT need to provide credentials again. When the user says "connect to X" or "SSH into X", X is the preset name — pass it directly as the "preset" parameter. If the preset does not exist, the server will return an error with available preset names. Any field can be overridden if needed.',
          inputSchema: {
            type: 'object',
            properties: {
              preset: { type: 'string', description: 'Name of the preset to use. When the user says "connect to my-server" or "SSH into the prod box", the preset name is exactly what they said (e.g., "my-server" or "prod")' },
              host: { type: 'string', description: 'Override the preset hostname or IP' },
              port: { type: 'number', description: 'Override the SSH port' },
              username: { type: 'string', description: 'Override the SSH username' },
              password: { type: 'string', description: 'Override or provide password authentication' },
              privateKeyPath: { type: 'string', description: 'Override or provide private key path' },
              passphrase: { type: 'string', description: 'Override or provide private key passphrase' },
              connectionId: { type: 'string', description: 'Unique identifier for this connection' }
            },
            required: ['preset']
          }
        }
      ]
    }));

    // Register tool call handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const toolName = request.params.name;
      
      // Handle core SSH tools directly
      if (toolName.startsWith('ssh_')) {
        switch (toolName) {
          case 'ssh_connect':
            return this.handleSSHConnect(request.params.arguments);
          case 'ssh_exec':
            return this.handleSSHExec(request.params.arguments);
          case 'ssh_upload_file':
            return this.handleSSHUpload(request.params.arguments);
          case 'ssh_download_file':
            return this.handleSSHDownload(request.params.arguments);
          case 'ssh_list_files':
            return this.handleSSHListFiles(request.params.arguments);
          case 'ssh_disconnect':
            return this.handleSSHDisconnect(request.params.arguments);
          case 'ssh_list_presets':
            return this.handleSSHListPresets(request.params.arguments);
          case 'ssh_connect_preset':
            return this.handleSSHConnectPreset(request.params.arguments);
          default:
            throw new Error(`Unknown SSH tool: ${toolName}`);
        }
      }
      
      // Handle Ubuntu tools directly
      if (toolName.startsWith('ubuntu_') && ubuntuToolHandlers[toolName]) {
        return ubuntuToolHandlers[toolName](request.params.arguments);
      }
      
      throw new Error(`Unknown tool: ${toolName}`);
    });
  }

  /**
   * Determine the config file path (in order of priority):
   * 1. SSH_MCP_HOSTS_CONFIG env var
   * 2. ~/.ssh-mcp.json
   * 3. hosts.json in cwd (legacy fallback)
   */
  private resolveConfigPath(): string | null {
    if (process.env.SSH_MCP_HOSTS_CONFIG) {
      return path.resolve(process.env.SSH_MCP_HOSTS_CONFIG);
    }

    const homeConfig = path.join(os.homedir(), '.ssh-mcp.json');
    if (fs.existsSync(homeConfig)) {
      return homeConfig;
    }

    const cwdConfig = path.join(process.cwd(), 'hosts.json');
    if (fs.existsSync(cwdConfig)) {
      return cwdConfig;
    }

    return null;
  }

  /**
   * Parse presets from a config file and populate this.presets.
   * Throws on invalid JSON or missing "presets" object.
   */
  private parsePresets(configPath: string): void {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed: HostsConfig = JSON.parse(raw);

    if (!parsed.presets || typeof parsed.presets !== 'object') {
      throw new Error('Invalid hosts config: missing "presets" object');
    }

    for (const [name, preset] of Object.entries(parsed.presets)) {
      if (!preset.host || !preset.username) {
        console.error(`Skipping preset "${name}": missing host or username`);
        continue;
      }

      if (!preset.password && !preset.privateKeyPath) {
        console.error(`Skipping preset "${name}": no password or privateKeyPath`);
        continue;
      }

      if (preset.privateKeyPath) {
        preset.privateKeyPath = preset.privateKeyPath.replace(/^~/, os.homedir());
      }

      if (!preset.port) {
        preset.port = 22;
      }

      this.presets.set(name, preset);
    }
  }

  /**
   * Reload presets from the current configPath.
   * On failure, keeps the previous presets (fail-safe).
   */
  private reloadPresets(): void {
    if (!this.configPath) return;

    const oldPresets = new Map(this.presets);
    this.presets.clear();

    try {
      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Config file no longer exists: ${this.configPath}`);
      }
      this.parsePresets(this.configPath);
      console.error(`Reloaded ${this.presets.size} SSH preset(s) from ${this.configPath}`);
    } catch (err: any) {
      console.error(`Failed to reload presets: ${err.message}`);
      console.error('Keeping previous presets.');
      this.presets = oldPresets;
    }
  }

  /**
   * Set up a file watcher on the config file for hot-reload.
   * Uses fs.watchFile with debounce to avoid multiple rapid reloads.
   * Only sets up the watcher once.
   */
  private setupConfigWatcher(): void {
    if (!this.configPath || this.isWatchingConfig) return;

    this.isWatchingConfig = true;

    fs.watchFile(this.configPath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtime.getTime() === prev.mtime.getTime()) return;

      if (this.reloadDebounceTimer) {
        clearTimeout(this.reloadDebounceTimer);
      }

      this.reloadDebounceTimer = setTimeout(() => {
        this.reloadDebounceTimer = null;
        console.error(`Config file changed, reloading presets...`);
        this.reloadPresets();
      }, 300);
    });
  }

  /**
   * Load preset host configurations on startup.
   * Also starts watching the config file for changes.
   */
  private loadPresets(): void {
    this.configPath = this.resolveConfigPath();

    if (!this.configPath || !fs.existsSync(this.configPath)) {
      console.error('No hosts config found. Expected one of:');
      console.error(`  - ${path.join(os.homedir(), '.ssh-mcp.json')} (recommended)`);
      console.error(`  - ${path.join(process.cwd(), 'hosts.json')} (legacy)`);
      console.error('Or set SSH_MCP_HOSTS_CONFIG env var. Preset tools will be unavailable.');
      return;
    }

    this.reloadPresets();
    this.setupConfigWatcher();
  }

  /**
   * Dynamically evaluate command timeout based on the command string.
   * Recognizes known long-running operations (npm install, docker build, etc.)
   * and returns an appropriate timeout in milliseconds.
   */
  private evaluateCommandTimeout(command: string, userTimeout?: number): number {
    // User explicitly set a timeout — respect it
    if (userTimeout !== undefined && userTimeout > 0) {
      return userTimeout;
    }

    const cmd = command.toLowerCase();

    // Package managers
    if (/\b(npm|yarn|pnpm)\b/.test(cmd)) {
      if (/\b(install|ci)\b/.test(cmd)) return 10 * 60 * 1000; // 10 min
      if (/\b(run build|build)\b/.test(cmd)) return 5 * 60 * 1000; // 5 min
      if (/\b(publish|pack)\b/.test(cmd)) return 3 * 60 * 1000;
      return 2 * 60 * 1000; // 2 min
    }

    // Docker
    if (/\bdocker\b/.test(cmd)) {
      if (/\bbuild\b/.test(cmd)) return 30 * 60 * 1000; // 30 min
      if (/\b(push|pull)\b/.test(cmd)) return 10 * 60 * 1000;
      if (/\brun\b/.test(cmd)) return 5 * 60 * 1000;
      return 2 * 60 * 1000;
    }

    // Git
    if (/\bgit\b/.test(cmd)) {
      if (/\b(clone|fetch)\b/.test(cmd)) return 5 * 60 * 1000;
      if (/\b(push|pull)\b/.test(cmd)) return 3 * 60 * 1000;
      return 60 * 1000;
    }

    // Build / compile
    if (/\b(make|cmake|gradle|mvn|go build|cargo build)\b/.test(cmd)) {
      return 10 * 60 * 1000;
    }

    // Test frameworks
    if (/\b(test|jest|pytest|mocha|cypress|playwright)\b/.test(cmd)) {
      return 5 * 60 * 1000;
    }

    // Database migrations
    if (/\b(migrate|prisma|sequelize|alembic)\b/.test(cmd)) {
      return 5 * 60 * 1000;
    }

    // Complex multi-command chains
    if ((cmd.match(/&&|\||;/g) || []).length >= 3) {
      return 5 * 60 * 1000;
    }

    // Default: 60 seconds
    return 60000;
  }

  private async handleSSHConnect(params: any) {
    const {
      host,
      port = 22,
      username,
      password,
      privateKeyPath,
      passphrase,
      connectionId = `ssh-${Date.now()}`
    } = params;

    // Verify we have either a password or a private key
    if (!password && !privateKeyPath) {
      return {
        content: [{ type: "text", text: "Either password or privateKeyPath must be provided" }],
        isError: true
      };
    }

    // Create SSH connection options
    const sshConfig: any = {
      host,
      port,
      username,
      readyTimeout: 30000, // 30 seconds timeout for connection
      keepaliveInterval: 30000, // Send keepalive every 30 seconds
      keepaliveCountMax: 3,     // Allow 3 missed keepalives before disconnect
    };

    // Add authentication method
    if (privateKeyPath) {
      try {
        // Expand tilde if present in the path
        const expandedPath = privateKeyPath.replace(/^~/, os.homedir());
        sshConfig.privateKey = fs.readFileSync(expandedPath);
        
        if (passphrase) {
          sshConfig.passphrase = passphrase;
        }
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Failed to read private key: ${error.message}` }],
          isError: true
        };
      }
    } else if (password) {
      sshConfig.password = password;
    }

    // Create a new SSH client
    const conn = new Client();
    
    try {
      // Connect to the server and wait for the "ready" event
      await new Promise((resolve, reject) => {
        conn.on("ready", () => {
          resolve(true);
        });
        
        conn.on("error", (err: Error) => {
          reject(new Error(`SSH connection error: ${err.message}`));
        });
        
        conn.connect(sshConfig);
      });
      
      // Store the connection for future use
      this.connections.set(connectionId, { conn, config: { host, port, username } });
      
      return {
        content: [{ 
          type: "text", 
          text: `Successfully connected to ${username}@${host}:${port}\nConnection ID: ${connectionId}` 
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Failed to connect: ${error.message}` }],
        isError: true
      };
    }
  }

  private async handleSSHExec(params: any) {
    const { connectionId, command, cwd, timeout: userTimeout } = params;
    const timeout = this.evaluateCommandTimeout(command, userTimeout);
    
    // Check if the connection exists
    if (!this.connections.has(connectionId)) {
      return {
        content: [{ type: "text", text: `No active SSH connection with ID: ${connectionId}` }],
        isError: true
      };
    }
    
    const { conn } = this.connections.get(connectionId)!;
    
    // Execute the command
    try {
      const result: any = await new Promise((resolve, reject) => {
        const execOptions: any = {};
        if (cwd) execOptions.cwd = cwd;
        
        // Set up timeout
        const timeoutId = setTimeout(() => {
          reject(new Error(`Command execution timed out after ${timeout}ms`));
        }, timeout);
        
        conn.exec(command, execOptions, (err: Error | undefined, stream: any) => {
          if (err) {
            clearTimeout(timeoutId);
            return reject(new Error(`Failed to execute command: ${err.message}`));
          }
          
          let stdout = '';
          let stderr = '';
          
          stream.on('close', (code: number, signal: string) => {
            clearTimeout(timeoutId);
            resolve({
              code,
              signal,
              stdout: stdout.trim(),
              stderr: stderr.trim()
            });
          });
          
          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });
          
          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
        });
      });
      
      const output = result.stdout || result.stderr || '(no output)';
      return {
        content: [{ 
          type: "text", 
          text: `Command: ${command}\nExit code: ${result.code}\nOutput:\n${output}` 
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Command execution failed: ${error.message}` }],
        isError: true
      };
    }
  }

  private async handleSSHUpload(params: any) {
    const { connectionId, localPath, remotePath } = params;
    
    // Check if the connection exists
    if (!this.connections.has(connectionId)) {
      return {
        content: [{ type: "text", text: `No active SSH connection with ID: ${connectionId}` }],
        isError: true
      };
    }
    
    const { conn } = this.connections.get(connectionId)!;
    
    try {
      // Expand tilde if present in the local path
      const expandedLocalPath = localPath.replace(/^~/, os.homedir());
      
      // Check if the local file exists
      if (!fs.existsSync(expandedLocalPath)) {
        return {
          content: [{ type: "text", text: `Local file does not exist: ${expandedLocalPath}` }],
          isError: true
        };
      }
      
      // Get SFTP client
      const sftp: any = await new Promise((resolve, reject) => {
        conn.sftp((err: Error | undefined, sftp: any) => {
          if (err) {
            reject(new Error(`Failed to initialize SFTP: ${err.message}`));
          } else {
            resolve(sftp);
          }
        });
      });
      
      // Upload the file
      await new Promise((resolve, reject) => {
        sftp.fastPut(expandedLocalPath, remotePath, (err: Error | undefined) => {
          if (err) {
            reject(new Error(`Failed to upload file: ${err.message}`));
          } else {
            resolve(true);
          }
        });
      });
      
      return {
        content: [{ type: "text", text: `Successfully uploaded ${expandedLocalPath} to ${remotePath}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `File upload failed: ${error.message}` }],
        isError: true
      };
    }
  }

  private async handleSSHDownload(params: any) {
    const { connectionId, remotePath, localPath } = params;
    
    // Check if the connection exists
    if (!this.connections.has(connectionId)) {
      return {
        content: [{ type: "text", text: `No active SSH connection with ID: ${connectionId}` }],
        isError: true
      };
    }
    
    const { conn } = this.connections.get(connectionId)!;
    
    try {
      // Expand tilde if present in the local path
      const expandedLocalPath = localPath.replace(/^~/, os.homedir());
      
      // Ensure the directory exists
      const dir = path.dirname(expandedLocalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Get SFTP client
      const sftp: any = await new Promise((resolve, reject) => {
        conn.sftp((err: Error | undefined, sftp: any) => {
          if (err) {
            reject(new Error(`Failed to initialize SFTP: ${err.message}`));
          } else {
            resolve(sftp);
          }
        });
      });
      
      // Download the file
      await new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, expandedLocalPath, (err: Error | undefined) => {
          if (err) {
            reject(new Error(`Failed to download file: ${err.message}`));
          } else {
            resolve(true);
          }
        });
      });
      
      return {
        content: [{ type: "text", text: `Successfully downloaded ${remotePath} to ${expandedLocalPath}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `File download failed: ${error.message}` }],
        isError: true
      };
    }
  }

  private async handleSSHListFiles(params: any) {
    const { connectionId, remotePath } = params;
    
    // Check if the connection exists
    if (!this.connections.has(connectionId)) {
      return {
        content: [{ type: "text", text: `No active SSH connection with ID: ${connectionId}` }],
        isError: true
      };
    }
    
    const { conn } = this.connections.get(connectionId)!;
    
    try {
      // Get SFTP client
      const sftp: any = await new Promise((resolve, reject) => {
        conn.sftp((err: Error | undefined, sftp: any) => {
          if (err) {
            reject(new Error(`Failed to initialize SFTP: ${err.message}`));
          } else {
            resolve(sftp);
          }
        });
      });
      
      // List files
      const files: any = await new Promise((resolve, reject) => {
        sftp.readdir(remotePath, (err: Error | undefined, list: any[]) => {
          if (err) {
            reject(new Error(`Failed to list files: ${err.message}`));
          } else {
            resolve(list);
          }
        });
      });
      
      const fileList = files.map((file: any) => ({
        filename: file.filename,
        isDirectory: (file.attrs.mode & 16384) === 16384,
        size: file.attrs.size,
        lastModified: new Date(file.attrs.mtime * 1000).toISOString()
      }));

      return {
        content: [{ 
          type: "text", 
          text: `Files in ${remotePath}:\n\n${JSON.stringify(fileList, null, 2)}` 
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Failed to list files: ${error.message}` }],
        isError: true
      };
    }
  }

  private async handleSSHDisconnect(params: any) {
    const { connectionId } = params;

    // Check if the connection exists
    if (!this.connections.has(connectionId)) {
      return {
        content: [{ type: "text", text: `No active SSH connection with ID: ${connectionId}` }],
        isError: true
      };
    }

    const { conn, config } = this.connections.get(connectionId)!;

    try {
      // Close the connection
      conn.end();
      this.connections.delete(connectionId);

      return {
        content: [{ type: "text", text: `Disconnected from ${config.username}@${config.host}:${config.port}` }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Failed to disconnect: ${error.message}` }],
        isError: true
      };
    }
  }

  private async handleSSHListPresets(_params: any) {
    if (this.presets.size === 0) {
      return {
        content: [{ type: "text", text: "No SSH presets configured. Create ~/.ssh-mcp.json or set SSH_MCP_HOSTS_CONFIG." }],
        isError: false
      };
    }

    const list = Array.from(this.presets.entries()).map(([name, preset]) => ({
      name,
      host: preset.host,
      port: preset.port,
      username: preset.username,
      authType: preset.privateKeyPath ? 'key' : 'password'
    }));

    return {
      content: [{
        type: "text",
        text: `Configured SSH presets:\n\n${JSON.stringify(list, null, 2)}`
      }]
    };
  }

  private async handleSSHConnectPreset(params: any) {
    const { preset: presetName, connectionId, ...overrides } = params;

    if (!this.presets.has(presetName)) {
      return {
        content: [{ type: "text", text: `Unknown preset: "${presetName}". Use ssh_list_presets to see available presets.` }],
        isError: true
      };
    }

    const preset = this.presets.get(presetName)!;

    const merged = {
      host: overrides.host ?? preset.host,
      port: overrides.port ?? preset.port,
      username: overrides.username ?? preset.username,
      password: overrides.password ?? preset.password,
      privateKeyPath: overrides.privateKeyPath ?? preset.privateKeyPath,
      passphrase: overrides.passphrase ?? preset.passphrase,
      connectionId
    };

    if (!merged.password && !merged.privateKeyPath) {
      return {
        content: [{ type: "text", text: `Preset "${presetName}" has no authentication method configured, and none was provided as an override. Please provide password or privateKeyPath.` }],
        isError: true
      };
    }

    return this.handleSSHConnect(merged);
  }

  async start() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      console.error("MCP SSH Server started. Waiting for requests...");
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.error("Shutting down MCP SSH Server...");
        
        // Close all active connections
        for (const [connectionId, { conn }] of this.connections.entries()) {
          try {
            conn.end();
          } catch (error: any) {
            console.error(`Failed to close connection ${connectionId}:`, error);
          }
        }
        
        process.exit(0);
      });
    } catch (error: any) {
      console.error("Failed to start MCP SSH Server:", error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new SSHMCPServer();
server.start().catch(console.error);
