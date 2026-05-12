/**
 * Federation — 跨项目联邦协作
 * 
 * 学习自 Ruflo federation-transport + plugin-agent-federation
 * 
 * 核心能力:
 * - 跨项目 Agent 通信与任务委托
 * - 共享记忆命名空间
 * - 项目发现与注册
 * - 零信任安全（API Key 验证）
 */

import { EventBus, type BusEvent, type EventType } from '../event-bus.js';
import { AgentMemory } from '../memory/agent-memory.js';

// ============= 类型 =============

export interface FederationNode {
  id: string;
  name: string;
  endpoint: string;       // 本地项目路径 或 远程 URL
  apiKey?: string;        // 远程访问密钥
  status: 'connected' | 'disconnected' | 'pending';
  lastSeen: string;
  sharedNamespaces: string[];
}

export interface FederationMessage {
  id: string;
  from: string;           // 源节点
  to: string;             // 目标节点
  type: 'task_delegate' | 'memory_share' | 'heartbeat' | 'discovery';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface FederationConfig {
  nodeId: string;
  nodeName: string;
  apiKey?: string;
  discoveryPath?: string;  // 共享发现文件路径
}

// ============= 实现 =============

export class Federation {
  private config: FederationConfig;
  private nodes: Map<string, FederationNode> = new Map();
  private eventBus: EventBus;
  private memory: AgentMemory;
  private discoveryTimer?: ReturnType<typeof setInterval>;

  constructor(config: FederationConfig, eventBus: EventBus, memory: AgentMemory) {
    this.config = config;
    this.eventBus = eventBus;
    this.memory = memory;
  }

  // ===== 节点管理 =====

  /** 注册远程节点 */
  registerNode(node: Omit<FederationNode, 'status' | 'lastSeen'>): void {
    this.nodes.set(node.id, {
      ...node,
      status: 'pending',
      lastSeen: new Date().toISOString(),
    });

    this.memory.put({
      namespace: `federation:${this.config.nodeId}`,
      type: 'context',
      key: `node:${node.id}`,
      content: `Federation node registered: ${node.name}`,
      metadata: { nodeId: node.id, endpoint: node.endpoint },
    });
  }

  /** 连接到节点 */
  async connect(nodeId: string): Promise<boolean> {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    try {
      // 发送发现消息
      await this.sendMessage({
        id: `msg-${Date.now()}`,
        from: this.config.nodeId,
        to: nodeId,
        type: 'discovery',
        payload: { nodeName: this.config.nodeName },
        
      });

      node.status = 'connected';
      node.lastSeen = new Date().toISOString();

      this.eventBus.emit('system:completed' as EventType, 'federation', {
        action: 'connected', nodeId,
      });

      return true;
    } catch (error) {
      console.error(`[Federation] 连接 ${nodeId} 失败:`, error);
      node.status = 'disconnected';
      return false;
    }
  }

  /** 断开节点 */
  disconnect(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) node.status = 'disconnected';
  }

  // ===== 消息 =====

  /** 发送联邦消息 */
  async sendMessage(msg: Omit<FederationMessage, 'id' | 'timestamp'> & { id?: string }): Promise<boolean> {
    const target = this.nodes.get(msg.to);
    if (!target || target.status !== 'connected') return false;

    const full: FederationMessage = {
      ...msg,
      id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      timestamp: new Date().toISOString(),
    };

    // 本地项目：文件传递
    if (target.endpoint.startsWith('/') || target.endpoint.startsWith('.')) {
      return this.sendLocal(full, target);
    }

    // 远程：HTTP（如果配置了 endpoint URL）
    return this.sendRemote(full, target);
  }

  /** 委托任务给联邦节点 */
  async delegateTask(
    targetNodeId: string,
    task: { title: string; description: string; domain: string }
  ): Promise<boolean> {
    return this.sendMessage({
      from: this.config.nodeId,
      to: targetNodeId,
      type: 'task_delegate',
      payload: task,
    });
  }

  /** 共享记忆 */
  async shareMemory(targetNodeId: string, memoryEntry: Record<string, unknown>): Promise<boolean> {
    return this.sendMessage({
      from: this.config.nodeId,
      to: targetNodeId,
      type: 'memory_share',
      payload: memoryEntry,
    });
  }

  // ===== 发现 =====

  /** 启动自动发现 */
  startDiscovery(intervalMs = 60000): void {
    this.discoveryTimer = setInterval(() => {
      for (const [id, node] of this.nodes) {
        if (node.status === 'connected') {
          this.sendMessage({
            from: this.config.nodeId,
            to: id,
            type: 'heartbeat',
            payload: { timestamp: new Date().toISOString() },
          }).catch(() => {
            node.status = 'disconnected';
          });
        }
      }
    }, intervalMs);
  }

  stopDiscovery(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
  }

  // ===== 查询 =====

  getConnectedNodes(): FederationNode[] {
    return [...this.nodes.values()].filter(n => n.status === 'connected');
  }

  getNode(nodeId: string): FederationNode | undefined {
    return this.nodes.get(nodeId);
  }

  getSummary(): string {
    const connected = this.getConnectedNodes().length;
    return `🌐 Federation: ${this.config.nodeName}
节点: ${this.nodes.size} 总数 | ${connected} 已连接`;
  }

  // ===== 传输层 =====

  private async sendLocal(msg: FederationMessage, target: FederationNode): Promise<boolean> {
    // 本地传输：写入共享文件
    try {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      const dir = join(target.endpoint, '.federation');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `msg-${msg.id}.json`),
        JSON.stringify(msg, null, 2)
      );
      return true;
    } catch {
      return false;
    }
  }

  private async sendRemote(msg: FederationMessage, target: FederationNode): Promise<boolean> {
    if (!target.apiKey) return false;

    try {
      const response = await fetch(`${target.endpoint}/federation/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /** 关闭 */
  shutdown(): void {
    this.stopDiscovery();
    this.memory.close();
  }
}
