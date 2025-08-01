import { VMConsoleProxy } from './vm-console-proxy';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

/**
 * VM Console Bridge connects the HTTP API with the VM Console Proxy
 * This allows HTTP requests to be translated to VM console commands
 */
export class VMConsoleBridge extends EventEmitter {
  private vmConsole: VMConsoleProxy;
  private taskId: string;
  private pendingRequests: Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private requestIdCounter: number = 0;

  constructor(taskId: string) {
    super();
    this.taskId = taskId;
    this.vmConsole = new VMConsoleProxy(taskId);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle VM console responses
    this.vmConsole.on('json-response', (response) => {
      this.handleJSONResponse(response);
    });

    this.vmConsole.on('exec-result', (result) => {
      this.handleExecResult(result);
    });

    this.vmConsole.on('terminal-output', (output) => {
      this.emit('terminal-output', output);
    });

    this.vmConsole.on('error', (error) => {
      logger.error(`[VM_CONSOLE_BRIDGE] VM console error for ${this.taskId}:`, error);
      this.emit('error', error);
    });

    this.vmConsole.on('connected', () => {
      logger.info(`[VM_CONSOLE_BRIDGE] VM console connected for ${this.taskId}`);
      this.emit('connected');
    });

    this.vmConsole.on('disconnected', () => {
      logger.info(`[VM_CONSOLE_BRIDGE] VM console disconnected for ${this.taskId}`);
      this.emit('disconnected');
    });

    this.vmConsole.on('boot-complete', () => {
      logger.info(`[VM_CONSOLE_BRIDGE] VM boot completed for ${this.taskId}`);
      this.emit('boot-complete');
    });
  }

  async startVM(): Promise<void> {
    await this.vmConsole.startVM();
  }

  async stopVM(): Promise<void> {
    // Clear all pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('VM stopping'));
    });
    this.pendingRequests.clear();

    await this.vmConsole.stopVM();
  }

  async executeFileOperation(operation: string, params: any): Promise<any> {
    const requestId = this.generateRequestId();
    const request = {
      id: requestId,
      type: 'file_operation',
      operation,
      params,
      timestamp: Date.now(),
    };

    return this.sendJSONRequest(request);
  }

  async executeGitOperation(operation: string, params: any): Promise<any> {
    const requestId = this.generateRequestId();
    const request = {
      id: requestId,
      type: 'git_operation',
      operation,
      params,
      timestamp: Date.now(),
    };

    return this.sendJSONRequest(request);
  }

  async executeCommand(command: string, options: any = {}): Promise<any> {
    const requestId = this.generateRequestId();
    const request = {
      id: requestId,
      type: 'command',
      command,
      options,
      timestamp: Date.now(),
    };

    return this.sendJSONRequest(request);
  }

  private async sendJSONRequest(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout for ${request.id}`));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout,
      });

      this.vmConsole.sendJSONRequest(request).catch((error) => {
        this.pendingRequests.delete(request.id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private handleJSONResponse(response: any): void {
    if (!response.id) {
      logger.warn(`[VM_CONSOLE_BRIDGE] Received response without ID:`, response);
      return;
    }

    const pendingRequest = this.pendingRequests.get(response.id);
    if (!pendingRequest) {
      logger.warn(`[VM_CONSOLE_BRIDGE] No pending request for ID: ${response.id}`);
      return;
    }

    const { resolve, reject, timeout } = pendingRequest;
    this.pendingRequests.delete(response.id);
    clearTimeout(timeout);

    if (response.error) {
      reject(new Error(response.error));
    } else {
      resolve(response.result);
    }
  }

  private handleExecResult(result: string): void {
    // Try to parse as JSON response first
    try {
      const jsonResponse = JSON.parse(result);
      if (jsonResponse.id) {
        this.handleJSONResponse(jsonResponse);
        return;
      }
    } catch {
      // Not JSON, treat as regular terminal output
    }

    // Emit as terminal output
    this.emit('terminal-output', result);
  }

  async sendTerminalInput(input: string): Promise<void> {
    await this.vmConsole.sendTerminalInput(input);
  }

  getVMStatus(): any {
    return this.vmConsole.getStatus();
  }

  async checkVMHealth(): Promise<boolean> {
    return await this.vmConsole.healthCheck();
  }

  private generateRequestId(): string {
    return `req_${this.taskId}_${++this.requestIdCounter}_${Date.now()}`;
  }

  isReady(): boolean {
    const status = this.vmConsole.getStatus();
    return status.connected && !status.booting;
  }

  async waitForReady(timeout: number = 120000): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkReady = () => {
        if (this.isReady()) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`VM not ready after ${timeout}ms`));
          return;
        }

        setTimeout(checkReady, 1000);
      };

      checkReady();
    });
  }
}

export class VMConsoleBridgeFactory {
  private static bridges: Map<string, VMConsoleBridge> = new Map();

  static async getBridge(taskId: string): Promise<VMConsoleBridge> {
    let bridge = this.bridges.get(taskId);

    if (!bridge) {
      bridge = new VMConsoleBridge(taskId);
      this.bridges.set(taskId, bridge);

      // Clean up bridge when VM stops
      bridge.on('disconnected', () => {
        this.bridges.delete(taskId);
      });

      // Start the VM
      await bridge.startVM();
    }

    return bridge;
  }

  static async removeBridge(taskId: string): Promise<void> {
    const bridge = this.bridges.get(taskId);
    if (bridge) {
      await bridge.stopVM();
      this.bridges.delete(taskId);
    }
  }

  static getActiveBridges(): string[] {
    return Array.from(this.bridges.keys());
  }

  static async stopAllBridges(): Promise<void> {
    const promises = Array.from(this.bridges.values()).map(bridge => bridge.stopVM());
    await Promise.all(promises);
    this.bridges.clear();
  }
}