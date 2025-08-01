import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as net from 'net';

/**
 * VM Console Proxy handles communication with Firecracker VM via serial console
 * Implements protocol multiplexing for terminal vs JSON API communication
 */
export class VMConsoleProxy extends EventEmitter {
  private taskId: string;
  private vmSocketPath: string;
  private vmProcess: ChildProcess | null = null;
  private consoleSocket: net.Socket | null = null;
  private isConnected: boolean = false;
  private messageBuffer: string = '';
  private isBooting: boolean = true;
  private consoleReady: boolean = false;

  // Protocol prefixes for message multiplexing
  private static readonly TERMINAL_PREFIX = 'TERM:';
  private static readonly JSON_PREFIX = 'JSON:';
  private static readonly EXEC_PREFIX = 'EXEC:';
  private static readonly SYSTEM_PREFIX = 'SYS:';

  constructor(taskId: string) {
    super();
    this.taskId = taskId;
    this.vmSocketPath = `/var/lib/firecracker/${taskId}/firecracker.socket`;
  }

  async startVM(): Promise<void> {
    try {
      logger.info(`[VM_CONSOLE] Starting VM for task ${this.taskId}`);

      // Ensure VM directory exists
      const vmDir = path.dirname(this.vmSocketPath);
      await fs.mkdir(vmDir, { recursive: true });

      // Generate VM configuration
      const vmConfig = await this.generateVMConfig();
      const vmConfigPath = path.join(vmDir, 'vm-config.json');
      await fs.writeFile(vmConfigPath, JSON.stringify(vmConfig, null, 2));

      // Start Firecracker with jailer for security
      const jailerArgs = [
        '--id', this.taskId,
        '--exec-file', '/usr/local/bin/firecracker',
        '--uid', '1000',
        '--gid', '1000',
        '--chroot-base-dir', '/srv/jailer',
        '--',
        '--config-file', vmConfigPath,
        '--api-sock', this.vmSocketPath,
      ];

      this.vmProcess = spawn('/usr/local/bin/jailer', jailerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          RUST_LOG: 'debug',
        },
      });

      // Handle VM process events
      this.vmProcess.on('error', (error) => {
        logger.error(`[VM_CONSOLE] VM process error for ${this.taskId}:`, error);
        this.emit('error', error);
      });

      this.vmProcess.on('exit', (code, signal) => {
        logger.info(`[VM_CONSOLE] VM process exited for ${this.taskId}: code=${code}, signal=${signal}`);
        this.isConnected = false;
        this.emit('vm-exit', { code, signal });
      });

      // Connect to VM console after a delay to allow VM boot
      setTimeout(() => {
        this.connectToConsole();
      }, 5000);

      logger.info(`[VM_CONSOLE] VM process started for task ${this.taskId}`);
    } catch (error) {
      logger.error(`[VM_CONSOLE] Failed to start VM for ${this.taskId}:`, error);
      throw error;
    }
  }

  private async connectToConsole(): Promise<void> {
    try {
      // Wait for VM socket to be available
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout

      while (attempts < maxAttempts) {
        try {
          await fs.access(this.vmSocketPath);
          break;
        } catch {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (attempts >= maxAttempts) {
        throw new Error(`VM socket not available after ${maxAttempts} seconds`);
      }

      // Connect to Firecracker console socket
      await this.connectToFirecrackerConsole();

      logger.info(`[VM_CONSOLE] Connected to VM console for ${this.taskId}`);

      // Monitor VM boot completion
      this.detectBootCompletion();
    } catch (error) {
      logger.error(`[VM_CONSOLE] Failed to connect to VM console for ${this.taskId}:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Connect to Firecracker console via Unix socket
   */
  private async connectToFirecrackerConsole(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create socket connection to Firecracker console
      this.consoleSocket = net.createConnection(this.vmSocketPath);

      this.consoleSocket.on('connect', () => {
        logger.info(`[VM_CONSOLE] Console socket connected for ${this.taskId}`);
        this.isConnected = true;
        this.consoleReady = true;
        this.emit('connected');
        resolve();
      });

      this.consoleSocket.on('data', (data: Buffer) => {
        const dataStr = data.toString();
        this.processConsoleData(dataStr);
      });

      this.consoleSocket.on('error', (error) => {
        logger.error(`[VM_CONSOLE] Console socket error for ${this.taskId}:`, error);
        this.isConnected = false;
        this.consoleReady = false;
        this.emit('error', error);
        reject(error);
      });

      this.consoleSocket.on('close', () => {
        logger.info(`[VM_CONSOLE] Console socket closed for ${this.taskId}`);
        this.isConnected = false;
        this.consoleReady = false;
        this.emit('disconnected');
      });

      // Set socket timeout
      this.consoleSocket.setTimeout(5000);
      this.consoleSocket.on('timeout', () => {
        logger.warn(`[VM_CONSOLE] Console socket timeout for ${this.taskId}`);
        this.consoleSocket?.destroy();
        reject(new Error('Console socket connection timeout'));
      });
    });
  }

  private async generateVMConfig(): Promise<any> {
    const vmDir = `/var/lib/firecracker/${this.taskId}`;
    const rootfsPath = '/var/lib/vm-images/shadow-rootfs.ext4';
    const kernelPath = '/var/lib/vm-images/vmlinux';

    return {
      'boot-source': {
        kernel_image_path: kernelPath,
        boot_args: 'console=ttyS0 reboot=k panic=1 pci=off init=/sbin/init',
      },
      drives: [
        {
          drive_id: 'rootfs',
          path_on_host: rootfsPath,
          is_root_device: true,
          is_read_only: false,
        },
      ],
      'machine-config': {
        vcpu_count: parseInt(process.env.VM_CPU_COUNT || '1'),
        mem_size_mib: parseInt(process.env.VM_MEMORY_SIZE_MB || '1024'),
        ht_enabled: false,
        track_dirty_pages: false,
      },
      'network-interfaces': [
        {
          iface_id: 'eth0',
          guest_mac: `AA:FC:00:00:${this.taskId.slice(-4, -2)}:${this.taskId.slice(-2)}`,
          host_dev_name: `tap${this.taskId}`,
        },
      ],
      logger: {
        log_path: `${vmDir}/firecracker.log`,
        level: 'Info',
        show_level: true,
        show_log_origin: true,
      },
      metrics: {
        metrics_path: `${vmDir}/firecracker.metrics`,
      },
    };
  }

  private detectBootCompletion(): void {
    // Monitor for specific boot completion markers
    const bootMarkers = [
      'shadow-sidecar.service: Succeeded',
      'Reached target Multi-User System',
      'shadow login:',
    ];

    let markersDetected = 0;

    this.on('console-output', (data: string) => {
      if (this.isBooting) {
        bootMarkers.forEach(marker => {
          if (data.includes(marker)) {
            markersDetected++;
            logger.debug(`[VM_CONSOLE] Boot marker detected: ${marker}`);
          }
        });

        // Boot complete when we see enough markers
        if (markersDetected >= 2) {
          this.isBooting = false;
          this.emit('boot-complete');
          logger.info(`[VM_CONSOLE] VM boot completed for ${this.taskId}`);
        }
      }
    });

    // Timeout for boot completion
    setTimeout(() => {
      if (this.isBooting) {
        this.isBooting = false;
        this.emit('boot-timeout');
        logger.warn(`[VM_CONSOLE] Boot timeout for ${this.taskId}`);
      }
    }, 120000); // 2 minute boot timeout
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('VM console not connected');
    }

    const message = `${VMConsoleProxy.EXEC_PREFIX}${command}\n`;
    await this.writeToConsole(message);
  }

  async sendTerminalInput(input: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('VM console not connected');
    }

    const message = `${VMConsoleProxy.TERMINAL_PREFIX}${input}`;
    await this.writeToConsole(message);
  }

  async sendJSONRequest(request: any): Promise<void> {
    if (!this.isConnected) {
      throw new Error('VM console not connected');
    }

    const message = `${VMConsoleProxy.JSON_PREFIX}${JSON.stringify(request)}\n`;
    await this.writeToConsole(message);
  }

  /**
   * Write data to VM console via socket
   */
  private async writeToConsole(data: string): Promise<void> {
    try {
      if (this.consoleSocket && this.consoleReady) {
        this.consoleSocket.write(data);
      } else {
        throw new Error('Console socket not ready for writing');
      }
    } catch (error) {
      logger.error(`[VM_CONSOLE] Failed to write to console for ${this.taskId}:`, error);
      throw error;
    }
  }

  private processConsoleData(data: string): void {
    this.messageBuffer += data;

    // Process complete messages (ended with newline)
    const messages = this.messageBuffer.split('\n');
    this.messageBuffer = messages.pop() || '';

    messages.forEach(message => {
      if (!message.trim()) return;

      if (message.startsWith(VMConsoleProxy.TERMINAL_PREFIX)) {
        const terminalData = message.slice(VMConsoleProxy.TERMINAL_PREFIX.length);
        this.emit('terminal-output', terminalData);
      } else if (message.startsWith(VMConsoleProxy.JSON_PREFIX)) {
        try {
          const jsonData = JSON.parse(message.slice(VMConsoleProxy.JSON_PREFIX.length));
          this.emit('json-response', jsonData);
        } catch (error) {
          logger.error(`[VM_CONSOLE] Failed to parse JSON message:`, { message, error });
        }
      } else if (message.startsWith(VMConsoleProxy.EXEC_PREFIX)) {
        const execResult = message.slice(VMConsoleProxy.EXEC_PREFIX.length);
        this.emit('exec-result', execResult);
      } else if (message.startsWith(VMConsoleProxy.SYSTEM_PREFIX)) {
        const systemMessage = message.slice(VMConsoleProxy.SYSTEM_PREFIX.length);
        this.emit('system-message', systemMessage);
      } else {
        // Raw console output (boot messages, etc.)
        this.emit('console-output', message);
      }
    });
  }

  async stopVM(): Promise<void> {
    try {
      logger.info(`[VM_CONSOLE] Stopping VM for task ${this.taskId}`);

      // Close console socket first
      if (this.consoleSocket) {
        this.consoleSocket.destroy();
        this.consoleSocket = null;
      }

      if (this.vmProcess) {
        // Send graceful shutdown signal
        this.vmProcess.kill('SIGTERM');

        // Wait for graceful shutdown, then force kill if needed
        setTimeout(() => {
          if (this.vmProcess && !this.vmProcess.killed) {
            logger.warn(`[VM_CONSOLE] Force killing VM process for ${this.taskId}`);
            this.vmProcess.kill('SIGKILL');
          }
        }, 10000); // 10 second grace period
      }

      this.isConnected = false;
      this.isBooting = false;
      this.consoleReady = false;
      this.emit('stopped');

      logger.info(`[VM_CONSOLE] VM stopped for task ${this.taskId}`);
    } catch (error) {
      logger.error(`[VM_CONSOLE] Failed to stop VM for ${this.taskId}:`, error);
      throw error;
    }
  }

  getStatus(): {
    connected: boolean;
    booting: boolean;
    taskId: string;
  } {
    return {
      connected: this.isConnected,
      booting: this.isBooting,
      taskId: this.taskId,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isConnected || this.isBooting || !this.consoleReady) {
        return false;
      }

      // Send a simple echo command to test responsiveness
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 5000);

        this.once('exec-result', (result) => {
          clearTimeout(timeout);
          resolve(result.includes('shadow-health-ok'));
        });

        this.sendCommand('echo "shadow-health-ok"').catch(() => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }
}