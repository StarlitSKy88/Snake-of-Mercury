/**
 * Agent Registry - Agent 注册表
 *
 * 管理所有已注册的 Agent，提供注册、注销、查找功能
 */

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

import type {
  AgentInfo,
  AgentStatus,
  RegisterAgentRequest
} from './types.js';

import { ERROR_CODES } from '../protocols/messages.js';

/**
 * 注册表错误
 */
export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly agentId?: string
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * Agent 回调接口
 */
export interface AgentCallbacks {
  onMessage?: (message: unknown) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: AgentStatus) => void;
}

/**
 * 注册表中的 Agent 条目
 */
interface RegistryEntry {
  info: AgentInfo;
  callbacks: AgentCallbacks;
  messageHandler?: (message: unknown) => void;
}

/**
 * Agent Registry - Agent 注册表管理器
 */
export class AgentRegistry extends EventEmitter {
  private agents: Map<string, RegistryEntry> = new Map();
  private parentChildRelations: Map<string, string[]> = new Map();
  private childrenByParent: Map<string, string[]> = new Map();

  constructor() {
    super();
  }

  /**
   * 注册 Agent
   */
  register(request: RegisterAgentRequest): AgentInfo {
    // 检查是否已存在同名 Agent
    const existing = this.findByName(request.name);
    if (existing) {
      throw new RegistryError(
        `Agent with name '${request.name}' already registered`,
        ERROR_CODES.AGENT_ALREADY_REGISTERED,
        existing.id
      );
    }

    const id = generateId();
    const now = new Date().toISOString();

    const info: AgentInfo = {
      id,
      name: request.name,
      type: request.type,
      status: 'pending',
      parentId: request.parentId,
      children: [],
      startedAt: now,
      lastActiveAt: now,
      metadata: request.metadata
    };

    this.agents.set(id, {
      info,
      callbacks: {}
    });

    // 建立父子关系
    if (request.parentId) {
      this.addChildRelation(request.parentId, id);
    }

    this.emit('agent:registered', info);
    this.updateStatus(id, 'running');

    return info;
  }

  /**
   * 注销 Agent
   */
  unregister(agentId: string): boolean {
    const entry = this.agents.get(agentId);
    if (!entry) {
      return false;
    }

    // 注销所有子 Agent
    const children = this.childrenByParent.get(agentId) || [];
    for (const childId of children) {
      this.unregister(childId);
    }

    // 移除父子关系
    if (entry.info.parentId) {
      this.removeChildRelation(entry.info.parentId, agentId);
    }

    // 更新关联的父 Agent 的 children 列表
    this.agents.delete(agentId);
    this.emit('agent:unregistered', entry.info);

    return true;
  }

  /**
   * 获取 Agent 信息
   */
  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId)?.info;
  }

  /**
   * 根据名称查找 Agent
   */
  findByName(name: string): AgentInfo | undefined {
    for (const entry of this.agents.values()) {
      if (entry.info.name === name) {
        return entry.info;
      }
    }
    return undefined;
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).map(entry => entry.info);
  }

  /**
   * 获取运行中的 Agent
   */
  getRunningAgents(): AgentInfo[] {
    return this.getAllAgents().filter(agent => agent.status === 'running' || agent.status === 'idle');
  }

  /**
   * 获取 Agent 数量
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * 更新 Agent 状态
   */
  updateStatus(agentId: string, status: AgentStatus): void {
    const entry = this.agents.get(agentId);
    if (!entry) {
      return;
    }

    const oldStatus = entry.info.status;
    if (oldStatus === status) {
      return;
    }

    entry.info.status = status;
    entry.info.lastActiveAt = new Date().toISOString();

    this.emit('agent:status_changed', {
      agentId,
      oldStatus,
      newStatus: status
    });
  }

  /**
   * 更新最后活跃时间
   */
  touch(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.info.lastActiveAt = new Date().toISOString();
    }
  }

  /**
   * 设置 Agent 回调
   */
  setCallbacks(agentId: string, callbacks: AgentCallbacks): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.callbacks = { ...entry.callbacks, ...callbacks };
    }
  }

  /**
   * 获取 Agent 回调
   */
  getCallbacks(agentId: string): AgentCallbacks | undefined {
    return this.agents.get(agentId)?.callbacks;
  }

  /**
   * 设置消息处理器
   */
  setMessageHandler(agentId: string, handler: (message: unknown) => void): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.messageHandler = handler;
    }
  }

  /**
   * 获取消息处理器
   */
  getMessageHandler(agentId: string): ((message: unknown) => void) | undefined {
    return this.agents.get(agentId)?.messageHandler;
  }

  /**
   * 获取 Agent 的子 Agent
   */
  getChildren(agentId: string): AgentInfo[] {
    const childIds = this.childrenByParent.get(agentId) || [];
    return childIds
      .map(id => this.getAgent(id))
      .filter((agent): agent is AgentInfo => agent !== undefined);
  }

  /**
   * 获取 Agent 的父 Agent
   */
  getParent(agentId: string): AgentInfo | undefined {
    const entry = this.agents.get(agentId);
    if (!entry || !entry.info.parentId) {
      return undefined;
    }
    return this.getAgent(entry.info.parentId);
  }

  /**
   * 检查 Agent 是否存在
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.agents.clear();
    this.parentChildRelations.clear();
    this.childrenByParent.clear();
  }

  // ============= 私有方法 =============

  /**
   * 添加子 Agent 关系
   */
  private addChildRelation(parentId: string, childId: string): void {
    // 子 -> 父
    const existingParents = this.parentChildRelations.get(childId) || [];
    if (!existingParents.includes(parentId)) {
      existingParents.push(parentId);
      this.parentChildRelations.set(childId, existingParents);
    }

    // 父 -> 子
    const existingChildren = this.childrenByParent.get(parentId) || [];
    if (!existingChildren.includes(childId)) {
      existingChildren.push(childId);
      this.childrenByParent.set(parentId, existingChildren);
    }

    // 更新 AgentInfo
    const parentEntry = this.agents.get(parentId);
    const childEntry = this.agents.get(childId);
    if (parentEntry && childEntry) {
      if (!parentEntry.info.children.includes(childId)) {
        parentEntry.info.children.push(childId);
      }
      childEntry.info.parentId = parentId;
    }
  }

  /**
   * 移除子 Agent 关系
   */
  private removeChildRelation(parentId: string, childId: string): void {
    // 子 -> 父
    const parents = this.parentChildRelations.get(childId) || [];
    const idx = parents.indexOf(parentId);
    if (idx !== -1) {
      parents.splice(idx, 1);
      if (parents.length === 0) {
        this.parentChildRelations.delete(childId);
      } else {
        this.parentChildRelations.set(childId, parents);
      }
    }

    // 父 -> 子
    const children = this.childrenByParent.get(parentId) || [];
    const childIdx = children.indexOf(childId);
    if (childIdx !== -1) {
      children.splice(childIdx, 1);
      if (children.length === 0) {
        this.childrenByParent.delete(parentId);
      } else {
        this.childrenByParent.set(parentId, children);
      }
    }
  }
}

// ============= 辅助函数 =============

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
}
