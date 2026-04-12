/**
 * Process Agent - 通过子进程运行的 Agent
 *
 * 使用 Claude CLI 作为 Agent 实现，通过 stdio 与 Hub 通信
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';

import type {
  JsonRpcRequest,
  JsonRpcResponse
} from '../protocols/messages.js';

import {
  METHODS,
  createRequest,
  createNotification
} from '../protocols/messages.js';

import type {
  AgentInfo,
  AgentStatus
} from '../hub/types.js';

/**
 * Process Agent 配置
 */
export interface ProcessAgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 类型 */
  type: string;
  /** 父 Agent ID */
  parentId?: string;
  /** Claude CLI 路径 */
  command?: string;
  /** CLI 参数 */
  args?: string[];
  /** 超时时间 (ms) */
  timeout?: number;
}

/**
 * Process Agent 内部配置
 */
interface AgentInternalConfig {
  name: string;
  type: string;
  parentId: string | undefined;
  command: string;
  args: string[];
  timeout: number;
}

/**
 * Process Agent 回调
 */
export interface ProcessAgentCallbacks {
  onMessage?: (method: string, params?: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onExit?: (code: number) => void;
  onRegistered?: (agentId: string) => void;
}

/**
 * Process Agent - 通过子进程运行的 Agent
 */
export class ProcessAgent extends EventEmitter {
  private config: AgentInternalConfig;
  private process: ChildProcess | null = null;
  private callbacks: ProcessAgentCallbacks;
  private agentId: string | null = null;
  private status: AgentStatus = 'pending';
  private outputBuffer: string = '';
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private connected: boolean = false;

  constructor(config: ProcessAgentConfig, callbacks?: ProcessAgentCallbacks) {
    super();
    this.config = {
      name: config.name,
      type: config.type,
      parentId: config.parentId,
      command: config.command || 'claude',
      args: config.args || ['--print'],
      timeout: config.timeout || 60000
    };
    this.callbacks = callbacks || {};
  }

  /**
   * 启动 Agent
   */
  async start(): Promise<AgentInfo> {
    if (this.process) {
      throw new Error('Agent already started');
    }

    this.status = 'pending';

    // Spawn 进程
    this.process = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 设置 stdout 处理
    this.process.stdout?.on('data', (data) => {
      this.outputBuffer += data.toString();
      this.processOutput();
    });

    // 设置 stderr 处理
    this.process.stderr?.on('data', (data) => {
      const errorOutput = data.toString();
      this.emit('stderr', errorOutput);

      // 检查是否是调试输出
      if (!errorOutput.includes('Error') && !errorOutput.includes('error')) {
        // 非错误输出，忽略
      }
    });

    // 设置错误处理
    this.process.on('error', (error) => {
      this.setStatus('error');
      this.callbacks.onError?.(error);
      this.emit('error', error);
    });

    // 设置退出处理
    this.process.on('close', (code) => {
      this.setStatus('stopped');
      this.callbacks.onExit?.(code || 0);
      this.emit('exit', code);
    });

    // 向 Hub 发送注册请求
    // 注意：这里需要 Hub 的支持，实际上由 Hub 调用 start() 并等待注册

    return this.createAgentInfo();
  }

  /**
   * 连接到 Hub
   */
  async connect(hubStdin: NodeJS.WritableStream, hubStdout: NodeJS.ReadableStream): Promise<void> {
    // 注册到 Hub
    const registerMsg = createRequest(
      this.generateId(),
      METHODS.HUB_REGISTER,
      {
        name: this.config.name,
        type: this.config.type,
        parentId: this.config.parentId
      }
    );

    hubStdout.on('data', (data) => {
      this.outputBuffer += data.toString();
      this.processOutput();
    });

    // 发送注册消息
    hubStdin.write(JSON.stringify(registerMsg) + '\n');

    // 等待注册响应
    const response = await this.waitForResponse(String(registerMsg.id));

    if (response && 'result' in response) {
      const result = response.result as { agentId: string };
      this.agentId = result.agentId;
      this.connected = true;
      this.setStatus('running');
      this.callbacks.onRegistered?.(this.agentId);
    } else {
      throw new Error('Failed to register with Hub');
    }
  }

  /**
   * 发送请求（等待响应）
   */
  async sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number
  ): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error('Agent not started');
    }

    const id = this.generateId();
    const request = createRequest(id, method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, timeout || this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout: timer });

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * 发送通知（不等待响应）
   */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      throw new Error('Agent not started');
    }

    const notification = createNotification(method, params);
    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * 发送原始消息
   */
  sendRaw(message: JsonRpcRequest): void {
    if (!this.process?.stdin) {
      throw new Error('Agent not started');
    }

    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  /**
   * 停止 Agent
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    // 清理待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Agent stopped'));
    }
    this.pendingRequests.clear();

    // 发送注销消息
    if (this.connected && this.process.stdin) {
      try {
        const unregisterMsg = createNotification(METHODS.HUB_UNREGISTER, {
          agentId: this.agentId
        });
        this.process.stdin.write(JSON.stringify(unregisterMsg) + '\n');
      } catch {
        // 忽略错误
      }
    }

    // 杀死进程
    this.process.kill();
    this.process = null;
    this.connected = false;
    this.setStatus('stopped');
  }

  /**
   * 获取 Agent ID
   */
  getId(): string | null {
    return this.agentId;
  }

  /**
   * 获取 Agent 名称
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * 获取 Agent 类型
   */
  getType(): string {
    return this.config.type;
  }

  /**
   * 获取 Agent 状态
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * 获取 Agent 信息
   */
  getInfo(): AgentInfo {
    return this.createAgentInfo();
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============= 私有方法 =============

  /**
   * 处理输出
   */
  private processOutput(): void {
    const lines = this.outputBuffer.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JsonRpcRequest | JsonRpcResponse;

        if ('id' in message && message.id !== undefined) {
          // 响应消息
          this.handleResponse(message as JsonRpcResponse);
        } else if ('method' in message) {
          // 请求消息或通知
          this.handleMessage(message as JsonRpcRequest);
        }
      } catch {
        // 非 JSON，忽略
      }
    }

    // 保留未完成的输出
    const lastNewline = this.outputBuffer.lastIndexOf('\n');
    if (lastNewline >= 0) {
      this.outputBuffer = this.outputBuffer.substring(lastNewline + 1);
    }
  }

  /**
   * 处理响应
   */
  private handleResponse(message: JsonRpcResponse): void {
    const id = String(message.id);
    const pending = this.pendingRequests.get(id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);

    if ('error' in message && message.error) {
      pending.reject(new Error(String(message.error)));
    } else {
      pending.resolve((message as { result?: unknown }).result);
    }
  }

  /**
   * 处理消息
   */
  private handleMessage(message: JsonRpcRequest): void {
    const { method, params } = message;

    switch (method) {
      case 'agent.receive':
        // 收到来自 Hub 的消息
        if (params && typeof params === 'object') {
          const p = params as { method?: string; from?: string };
          this.callbacks.onMessage?.(p.method || 'unknown', params);
          this.emit('message', { method: p.method, params });
        }
        break;

      case 'agent.request':
        // 收到来自另一个 Agent 的请求
        if (params && typeof params === 'object') {
          const p = params as { method?: string; from?: string; originalId?: string };
          this.callbacks.onMessage?.(p.method || 'unknown', params);
          this.emit('request', { method: p.method, from: p.from, originalId: p.originalId, params });
        }
        break;

      default:
        this.emit('message', { method, params });
    }
  }

  /**
   * 等待响应
   */
  private waitForResponse(id: string, timeout: number = 30000): Promise<JsonRpcResponse | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(null);
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as JsonRpcResponse);
        },
        reject: () => {
          clearTimeout(timer);
          resolve(null);
        },
        timeout: timer
      });
    });
  }

  /**
   * 设置状态
   */
  private setStatus(status: AgentStatus): void {
    if (this.status !== status) {
      const oldStatus = this.status;
      this.status = status;
      this.emit('statusChanged', { oldStatus, newStatus: status });
    }
  }

  /**
   * 创建 Agent 信息
   */
  private createAgentInfo(): AgentInfo {
    return {
      id: this.agentId || this.generateId(),
      name: this.config.name,
      type: this.config.type,
      status: this.status,
      parentId: this.config.parentId,
      children: [],
      startedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    };
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
  }
}
