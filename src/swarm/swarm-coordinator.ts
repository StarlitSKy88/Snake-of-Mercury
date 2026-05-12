/**
 * SwarmCoordinator — 蜂群协作调度器
 * 
 * 学习自 Ruflo UnifiedSwarmCoordinator + SwarmHub
 * 
 * 核心能力:
 * - Agent 注册/生命周期管理（spawn/terminate/heartbeat）
 * - 任务编排（submit/assign/complete/reassign）
 * - 拓扑支持（hierarchical/mesh）
 * - 健康检查 + 故障转移
 * - 集成 EventBus + AgentMemory
 */

import { EventBus, type BusEvent, type EventType } from '../event-bus.js';
import { AgentMemory, type MemoryEntry } from '../memory/agent-memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============= 类型 =============

export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';
export type SwarmTopology = 'hierarchical' | 'mesh' | 'adaptive';
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  domain: string;
  capabilities: string[];
  engine: AgentEngine;
  topology?: SwarmTopology;
  metadata?: Record<string, unknown>;
}

export interface AgentState {
  definition: AgentDefinition;
  status: AgentStatus;
  currentTask?: string;
  lastHeartbeat: string;
  spawnTime: string;
  errorCount: number;
  completedTasks: number;
}

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  domain: string;
  priority: 1 | 2 | 3;
  assignedTo?: string;
  status: TaskStatus;
  dependencies: string[];
  result?: TaskResult;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retries: number;
  maxRetries: number;
}

export interface TaskResult {
  success: boolean;
  output: string;
  error?: string;
  metrics?: Record<string, number>;
}

export interface SwarmConfig {
  topology: SwarmTopology;
  maxAgents: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxRetriesPerTask: number;
  projectId: string;
}

export interface SwarmState {
  agents: Map<string, AgentState>;
  tasks: Map<string, TaskDefinition>;
  topology: SwarmTopology;
  projectId: string;
  startedAt: string;
  activeAgents: number;
  completedTasks: number;
  failedTasks: number;
}

// ============= 默认配置 =============

const DEFAULT_CONFIG: SwarmConfig = {
  topology: 'hierarchical',
  maxAgents: 15,
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutMs: 30000,
  maxRetriesPerTask: 3,
  projectId: 'default',
};

// ============= 实现 =============

export class SwarmCoordinator {
  private config: SwarmConfig;
  private agents: Map<string, AgentState> = new Map();
  private tasks: Map<string, TaskDefinition> = new Map();
  private eventBus: EventBus;
  private memory: AgentMemory;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    config: Partial<SwarmConfig> = {},
    eventBus: EventBus,
    memory: AgentMemory,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = eventBus;
    this.memory = memory;
  }

  // ===== Agent 管理 =====

  /** 注册 Agent */
  registerAgent(def: AgentDefinition): AgentState {
    const state: AgentState = {
      definition: def,
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      spawnTime: new Date().toISOString(),
      errorCount: 0,
      completedTasks: 0,
    };

    this.agents.set(def.id, state);

    this.eventBus.emit('system:completed' as EventType, 'swarm', {
      agentId: def.id,
      action: 'registered',
      projectId: this.config.projectId,
    });

    // 持久化
    this.memory.put({
      namespace: this.config.projectId,
      type: 'context',
      key: `agent:${def.id}`,
      content: `Agent registered: ${def.name} (${def.role})`,
      metadata: { agentId: def.id, role: def.role, domain: def.domain },
    });

    return state;
  }

  /** 注销 Agent */
  unregisterAgent(agentId: string): boolean {
    const result = this.agents.delete(agentId);
    if (result) {
      this.eventBus.emit('system:completed' as EventType, 'swarm', {
        agentId, action: 'unregistered',
        projectId: this.config.projectId,
      });
    }
    return result;
  }

  /** 心跳 */
  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = new Date().toISOString();
      if (agent.status === 'offline') agent.status = 'idle';
    }
  }

  /** 更新 Agent 状态 */
  updateAgentStatus(agentId: string, status: AgentStatus, error?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const prevStatus = agent.status;
    agent.status = status;
    if (status === 'error' && error) {
      agent.errorCount++;
      this.memory.put({
        namespace: this.config.projectId,
        type: 'anti_pattern',
        key: `error:${agentId}:${Date.now()}`,
        content: error,
        metadata: { agentId, errorCount: agent.errorCount },
      });
    }

    this.eventBus.emit('system:error' as EventType, 'swarm', {
      agentId, prevStatus, newStatus: status, error,
      projectId: this.config.projectId,
    });
  }

  // ===== 任务管理 =====

  /** 提交任务 */
  submitTask(task: Omit<TaskDefinition, 'id' | 'status' | 'retries' | 'createdAt'>): TaskDefinition {
    const full: TaskDefinition = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'pending',
      retries: 0,
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(full.id, full);

    // 自动分配
    this.assignTask(full.id);

    return full;
  }

  /** 批量提交 */
  submitBatch(tasks: Omit<TaskDefinition, 'id' | 'status' | 'retries' | 'createdAt'>[]): TaskDefinition[] {
    return tasks.map(t => this.submitTask(t));
  }

  /** 分配任务给最合适的 Agent */
  assignTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') return false;

    // 找匹配 domain 且 idle 的 Agent
    const candidates = [...this.agents.values()]
      .filter(a => a.status === 'idle' && a.definition.domain === task.domain);

    if (candidates.length === 0) {
      // 找任何 idle Agent
      const anyIdle = [...this.agents.values()].find(a => a.status === 'idle');
      if (!anyIdle) return false;
      return this.doAssign(task, anyIdle.definition.id);
    }

    // 找最少完成任务数的（负载均衡）
    candidates.sort((a, b) => a.completedTasks - b.completedTasks);
    return this.doAssign(task, candidates[0].definition.id);
  }

  private doAssign(task: TaskDefinition, agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    task.assignedTo = agentId;
    task.status = 'assigned';
    task.startedAt = new Date().toISOString();
    agent.status = 'busy';
    agent.currentTask = task.id;

    this.eventBus.emit('sprint:started' as EventType, 'swarm', {
      taskId: task.id, agentId, title: task.title,
      projectId: this.config.projectId,
    });

    return true;
  }

  /** 完成任务 */
  completeTask(taskId: string, result: TaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = result.success ? 'completed' : 'failed';
    task.result = result;
    task.completedAt = new Date().toISOString();

    // 释放 Agent
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.status = "idle";
        agent.currentTask = undefined;
        if (result.success) agent.completedTasks++;
      }
    }

    // 失败则重试
    if (!result.success && task.retries < task.maxRetries) {
      task.retries++;
      task.status = 'pending';
      task.assignedTo = undefined;
      this.assignTask(taskId);
      return;
    }

    // 持久化结果
    this.memory.put({
      namespace: this.config.projectId,
      type: 'task_result',
      key: `task:${taskId}`,
      content: result.success ? `✅ ${task.title}` : `❌ ${task.title}: ${result.error}`,
      metadata: { taskId, agentId: task.assignedTo, success: result.success },
    });

    // 分配下一个 pending 任务
    for (const [id, t] of this.tasks) {
      if (t.status === 'pending') {
        this.assignTask(id);
        break;
      }
    }
  }

  // ===== 健康检查 =====

  startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) return;
    this.running = true;

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, agent] of this.agents) {
        const lastHb = new Date(agent.lastHeartbeat).getTime();
        if (now - lastHb > this.config.heartbeatTimeoutMs) {
          this.updateAgentStatus(id, 'offline');
          // 重新分配该 Agent 的任务
          if (agent.currentTask) {
            const task = this.tasks.get(agent.currentTask);
            if (task && task.status === 'assigned') {
              task.status = 'pending';
              task.assignedTo = undefined;
              this.assignTask(task.id);
            }
          }
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  stopHeartbeatMonitor(): void {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  // ===== 查询 =====

  getState(): SwarmState {
    return {
      agents: new Map(this.agents),
      tasks: new Map(this.tasks),
      topology: this.config.topology,
      projectId: this.config.projectId,
      startedAt: new Date().toISOString(),
      activeAgents: [...this.agents.values()].filter(a => a.status !== 'offline').length,
      completedTasks: [...this.tasks.values()].filter(t => t.status === 'completed').length,
      failedTasks: [...this.tasks.values()].filter(t => t.status === 'failed').length,
    };
  }

  getAgent(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  getTask(taskId: string): TaskDefinition | undefined {
    return this.tasks.get(taskId);
  }

  getPendingTasks(): TaskDefinition[] {
    return [...this.tasks.values()].filter(t => t.status === 'pending');
  }

  getSummary(): string {
    const state = this.getState();
    const bar = this.makeBar(state.completedTasks, state.tasks.size || 1);
    return `🐝 Swarm ${this.config.projectId}
${bar} ${state.completedTasks}/${state.tasks.size} 任务完成
🤖 ${state.activeAgents}/${this.agents.size} Agent 活跃
📐 拓扑: ${this.config.topology}`;
  }

  private makeBar(current: number, total: number): string {
    const w = 12;
    const filled = Math.round((current / Math.max(total, 1)) * w);
    return '█'.repeat(filled) + '░'.repeat(w - filled);
  }

  /** 关闭 */
  shutdown(): void {
    this.stopHeartbeatMonitor();
    this.memory.close();
  }
}
