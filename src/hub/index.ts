/**
 * Hub - 多 Agent 通信中枢
 *
 * 实现类似 Loopal 的 Hub 架构：
 * - Agent 注册和发现
 * - 消息路由
 * - 生命周期管理
 * - 事件广播
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';

import { AgentRegistry } from './registry.js';
import { MessageRouter } from './router.js';

import type {
  HubConfig,
  AgentInfo,
  SpawnAgentRequest,
  RegisterAgentRequest
} from './types.js';

import type {
  JsonRpcRequest,
  JsonRpcResponse
} from '../protocols/messages.js';

import {
  createSuccessResponse,
  createErrorResponse,
  METHODS,
  ERROR_CODES
} from '../protocols/messages.js';

/**
 * Hub 内部状态
 */
interface HubState {
  startedAt: string;
  totalMessages: number;
  running: boolean;
}

/**
 * Hub 主类
 */
export class Hub extends EventEmitter {
  private config: Required<HubConfig>;
  private registry: AgentRegistry;
  private router: MessageRouter;
  private state: HubState;
  private agentProcesses: Map<string, ChildProcess> = new Map();
  private pendingResponses: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(config: HubConfig) {
    super();
    this.config = {
      name: config.name || 'snake-of-mercury-hub',
      logLevel: config.logLevel || 'info',
      agentTimeout: config.agentTimeout || 60000,
      maxAgents: config.maxAgents || 100,
      strictMode: config.strictMode ?? false,
      enableBroadcast: config.enableBroadcast ?? true,
      defaultAgentCommand: config.defaultAgentCommand || 'claude',
      defaultAgentArgs: config.defaultAgentArgs || ['--print']
    };

    this.registry = new AgentRegistry();
    this.router = new MessageRouter(this.registry, this.handleMessage.bind(this));
    this.state = {
      startedAt: new Date().toISOString(),
      totalMessages: 0,
      running: false
    };

    this.setupEventHandlers();
  }

  /**
   * 启动 Hub
   */
  async start(): Promise<void> {
    if (this.state.running) {
      throw new Error('Hub is already running');
    }

    this.state.running = true;
    this.emit('hub:ready', { version: '2.0' });
    this.log('info', 'Hub started');
  }

  /**
   * 停止 Hub
   */
  async stop(): Promise<void> {
    if (!this.state.running) {
      return;
    }

    this.log('info', 'Hub shutting down...');

    // 终止所有 Agent
    for (const [agentId, proc] of this.agentProcesses) {
      proc.kill();
      this.agentProcesses.delete(agentId);
    }

    // 清空注册表
    this.registry.clear();

    this.state.running = false;
    this.emit('hub:closing');
    this.log('info', 'Hub stopped');
  }

  /**
   * 获取 Hub 状态
   */
  isRunning(): boolean {
    return this.state.running;
  }

  /**
   * 获取 Hub 配置
   */
  getConfig(): Readonly<Required<HubConfig>> {
    return { ...this.config };
  }

  /**
   * 获取 Hub 统计信息
   */
  getMetrics(): {
    uptime: number;
    totalMessages: number;
    totalAgents: number;
    activeAgents: number;
  } {
    const uptime = Date.now() - new Date(this.state.startedAt).getTime();
    const agents = this.registry.getAllAgents();

    return {
      uptime,
      totalMessages: this.state.totalMessages,
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === 'running').length
    };
  }

  /**
   * 注册 Agent（通过 Hub 注册请求）
   */
  async registerAgent(request: RegisterAgentRequest): Promise<AgentInfo> {
    if (!this.state.running) {
      throw new Error('Hub is not running');
    }

    if (this.registry.getAgentCount() >= this.config.maxAgents) {
      throw new Error(`Maximum number of agents (${this.config.maxAgents}) reached`);
    }

    return this.registry.register(request);
  }

  /**
   * Spawn Agent 进程
   */
  async spawnAgent(request: SpawnAgentRequest): Promise<AgentInfo> {
    if (!this.state.running) {
      throw new Error('Hub is not running');
    }

    if (this.registry.getAgentCount() >= this.config.maxAgents) {
      throw new Error(`Maximum number of agents (${this.config.maxAgents}) reached`);
    }

    // Spawn 进程
    const proc = spawn(request.command, request.args || [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 生成 Agent ID
    const agentId = this.generateId();

    // 保存进程
    this.agentProcesses.set(agentId, proc);

    // 设置 stdout 处理
    let outputBuffer = '';
    proc.stdout?.on('data', (data) => {
      outputBuffer += data.toString();

      // 按行处理消息
      const lines = outputBuffer.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const message = JSON.parse(line);
          this.handleAgentMessage(agentId, message);
        } catch {
          // 非 JSON，可能是调试输出
          this.emit('agent:output', { agentId, output: line });
        }
      }
    });

    // 设置 stderr 处理
    proc.stderr?.on('data', (data) => {
      this.emit('agent:stderr', { agentId, output: data.toString() });
    });

    // 设置退出处理
    proc.on('exit', (code) => {
      this.handleAgentExit(agentId, code || 0);
    });

    // 注册 Agent
    const info = this.registry.register({
      name: request.name,
      type: request.type,
      parentId: request.parentId,
      metadata: request.metadata
    });

    // 更新为实际 ID
    // 注意：注册时会生成新 ID，这里需要同步
    // 暂时使用注册生成的 ID

    // 发送注册消息给 Agent
    this.sendToAgent(agentId, {
      jsonrpc: '2.0',
      method: METHODS.HUB_REGISTER,
      params: {
        name: request.name,
        type: request.type,
        parentId: request.parentId
      }
    });

    this.emit('agent:spawned', { agentId, info });
    this.log('info', `Agent spawned: ${request.name} (${agentId})`);

    return info;
  }

  /**
   * 终止 Agent
   */
  async terminateAgent(agentId: string, force: boolean = false): Promise<void> {
    const proc = this.agentProcesses.get(agentId);
    if (!proc) {
      throw new Error(`Agent ${agentId} not found`);
    }

    this.registry.updateStatus(agentId, 'stopping');

    if (force) {
      proc.kill('SIGKILL');
    } else {
      proc.kill('SIGTERM');
    }

    // 等待进程退出（会在 on('exit') 中处理清理）
  }

  /**
   * 向 Agent 发送消息
   */
  sendToAgent(agentId: string, message: JsonRpcRequest): void {
    const proc = this.agentProcesses.get(agentId);
    if (!proc || !proc.stdin) {
      this.emit('hub:error', { error: `Agent ${agentId} not connected` });
      return;
    }

    proc.stdin.write(JSON.stringify(message) + '\n');
    this.state.totalMessages++;
  }

  /**
   * 通过 Hub 路由消息
   */
  async routeMessage(request: JsonRpcRequest, sourceId: string): Promise<JsonRpcResponse | null> {
    const result = await this.router.route(request, sourceId);
    this.state.totalMessages++;
    return result.response || null;
  }

  /**
   * 广播消息给所有 Agent
   */
  broadcast(method: string, params?: Record<string, unknown>, exclude?: string[]): void {
    const agents = this.registry.getAllAgents();
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'agent.receive',
      params: {
        method,
        params,
        broadcast: true
      }
    };

    for (const agent of agents) {
      if (exclude?.includes(agent.id)) {
        continue;
      }
      this.sendToAgent(agent.id, message);
    }
  }

  // ============= 私有方法 =============

  /**
   * 处理需要转发给 Agent 的消息
   */
  private handleMessage(toAgentId: string, message: JsonRpcRequest): void {
    this.sendToAgent(toAgentId, message);
  }

  /**
   * 处理来自 Agent 的消息
   */
  private handleAgentMessage(agentId: string, message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as JsonRpcRequest;

    // 检查是否是响应消息（带 id）
    if ('id' in msg && msg.id) {
      this.handleAgentResponse(agentId, msg);
      return;
    }

    // 处理请求消息
    if ('method' in msg) {
      this.routeMessage(msg, agentId);
    }
  }

  /**
   * 处理 Agent 响应
   */
  private handleAgentResponse(agentId: string, response: JsonRpcRequest): void {
    const id = String(response.id);

    // 检查是否是原始请求的响应
    if (id.startsWith('req_')) {
      // 这是对另一个 Agent 请求的响应，需要路由回去
      // 格式: req_{sourceId}_{originalId}
      const parts = id.split('_');
      if (parts.length >= 3) {
        const originalSourceId = parts[1];
        const originalId = parts.slice(2).join('_');

        const routedResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: originalId,
          result: response.params
        };

        this.sendToAgent(originalSourceId, routedResponse as unknown as JsonRpcRequest);
      }
      return;
    }

    // 处理 Hub 发起的请求的响应
    const pending = this.pendingResponses.get(id);
    if (pending) {
      this.pendingResponses.delete(id);
      if ('error' in response && response.error) {
        pending.reject(new Error(String(response.error)));
      } else {
        pending.resolve(response.params);
      }
    }
  }

  /**
   * 处理 Agent 退出
   */
  private handleAgentExit(agentId: string, code: number): void {
    const proc = this.agentProcesses.get(agentId);
    if (proc) {
      this.agentProcesses.delete(agentId);
    }

    this.registry.unregister(agentId);
    this.emit('agent:terminated', { agentId, code });
    this.log('info', `Agent terminated: ${agentId} (code: ${code})`);

    // 如果是父子关系，处理级联关闭
    const children = this.registry.getChildren(agentId);
    if (children.length > 0) {
      this.log('info', `Cascading termination for ${children.length} children`);
      for (const child of children) {
        this.terminateAgent(child.id, true).catch(() => {});
      }
    }
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // Agent 注册事件
    this.registry.on('agent:registered', (info: AgentInfo) => {
      this.emit('agent:registered', info);
    });

    // Agent 注销事件
    this.registry.on('agent:unregistered', (info: AgentInfo) => {
      this.emit('agent:unregistered', info);
    });

    // Agent 状态变更
    this.registry.on('agent:status_changed', (data: {
      agentId: string;
      oldStatus: string;
      newStatus: string;
    }) => {
      this.emit('agent:status_changed', data);
    });

    // 路由器的 spawn 请求
    this.router.on('agent:spawn_requested', async (data: {
      request: SpawnAgentRequest;
      requesterId: string;
    }) => {
      try {
        await this.spawnAgent(data.request);
      } catch (error) {
        this.emit('hub:error', { error });
      }
    });

    // 路由器的 terminate 请求
    this.router.on('agent:terminate_requested', async (data: {
      agentId: string;
      force: boolean;
      requesterId: string;
    }) => {
      try {
        await this.terminateAgent(data.agentId, data.force);
      } catch (error) {
        this.emit('hub:error', { error });
      }
    });

    // 路由器的关闭请求
    this.router.on('hub:shutdown_requested', () => {
      this.stop().catch(error => this.emit('hub:error', { error }));
    });
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
  }

  /**
   * 日志记录
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels: Record<string, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };

    if (levels[level] >= levels[this.config.logLevel]) {
      console.log(`[Hub][${level.toUpperCase()}] ${message}`);
    }
  }
}

// ============= 工厂函数 =============

/**
 * 创建 Hub 实例
 */
export function createHub(config: HubConfig): Hub {
  return new Hub(config);
}

/**
 * 创建并启动 Hub
 */
export async function startHub(config: HubConfig): Promise<Hub> {
  const hub = new Hub(config);
  await hub.start();
  return hub;
}
