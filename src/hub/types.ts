/**
 * Hub Types - Hub 核心类型定义
 */

// ============= Agent 类型 =============

/**
 * Agent 状态
 */
export type AgentStatus =
  | 'pending'    // 正在启动
  | 'running'    // 运行中
  | 'idle'       // 空闲等待
  | 'busy'       // 处理任务中
  | 'stopping'   // 正在停止
  | 'stopped'    // 已停止
  | 'error';     // 出错

/**
 * Agent 元信息
 */
export interface AgentInfo {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  parentId?: string;
  children: string[];
  startedAt: string;
  lastActiveAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agent 注册请求
 */
export interface RegisterAgentRequest {
  name: string;
  type: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agent 注册响应
 */
export interface RegisterAgentResponse {
  agentId: string;
  hubVersion: string;
  sessionId: string;
}

/**
 * Agent 能力描述
 */
export interface AgentCapabilities {
  /** 支持的消息类型 */
  supportedMethods?: string[];
  /** 是否支持广播 */
  supportsBroadcast?: boolean;
  /** 是否支持 spawn */
  canSpawn?: boolean;
  /** 最大并发请求数 */
  maxConcurrentRequests?: number;
}

// ============= Hub 配置 =============

/**
 * Hub 配置
 */
export interface HubConfig {
  /** Hub 标识名 */
  name?: string;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Agent 默认超时时间 (ms) */
  agentTimeout: number;
  /** 最大 Agent 数量 */
  maxAgents: number;
  /** 是否启用严格模式 */
  strictMode: boolean;
  /** 是否启用事件广播 */
  enableBroadcast?: boolean;
  /** Agent 默认启动命令 */
  defaultAgentCommand?: string;
  /** Agent 默认启动参数 */
  defaultAgentArgs?: string[];
}

/**
 * 默认配置
 */
export const DEFAULT_HUB_CONFIG: Partial<HubConfig> = {
  logLevel: 'info',
  agentTimeout: 60000,
  maxAgents: 100,
  strictMode: false,
  enableBroadcast: true
};

// ============= Hub 事件 =============

/**
 * Hub 事件类型
 */
export type HubEventType =
  | 'agent:registered'
  | 'agent:unregistered'
  | 'agent:status_changed'
  | 'agent:error'
  | 'agent:spawned'
  | 'agent:terminated'
  | 'message:sent'
  | 'message:received'
  | 'message:routed'
  | 'broadcast:start'
  | 'broadcast:end'
  | 'session:created'
  | 'session:ended'
  | 'hub:ready'
  | 'hub:closing'
  | 'hub:error';

/**
 * Hub 事件
 */
export interface HubEvent {
  type: HubEventType;
  timestamp: string;
  payload: unknown;
  source?: string;
  target?: string;
}

/**
 * Agent 状态变更事件
 */
export interface AgentStatusChangedEvent {
  agentId: string;
  oldStatus: AgentStatus;
  newStatus: AgentStatus;
}

/**
 * 消息路由事件
 */
export interface MessageRoutedEvent {
  messageId: string;
  from: string;
  to: string;
  method: string;
  timestamp: string;
}

// ============= 会话管理 =============

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  name?: string;
  agents: string[];
  createdAt: string;
  lastActivityAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * 创建会话请求
 */
export interface CreateSessionRequest {
  name?: string;
  agents?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 加入会话请求
 */
export interface JoinSessionRequest {
  sessionId: string;
  agentId: string;
}

// ============= 生命周期管理 =============

/**
 * Spawn Agent 请求
 */
export interface SpawnAgentRequest {
  name: string;
  type: string;
  command: string;
  args?: string[];
  parentId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Spawn Agent 响应
 */
export interface SpawnAgentResponse {
  agentId: string;
  status: 'spawned' | 'spawning' | 'failed';
  error?: string;
}

/**
 * Terminate Agent 请求
 */
export interface TerminateAgentRequest {
  agentId: string;
  force?: boolean;
}

/**
 * 父子关系
 */
export interface ParentChildRelation {
  parentId: string;
  childId: string;
}

// ============= 消息传递 =============

/**
 * 点对点消息
 */
export interface AgentMessage {
  from: string;
  to: string;
  method: string;
  params?: Record<string, unknown>;
  id?: string;
  timestamp?: string;
}

/**
 * 广播消息
 */
export interface BroadcastMessage {
  from: string;
  method: string;
  params?: Record<string, unknown>;
  exclude?: string[];
  timestamp?: string;
}

// ============= Hub 统计 =============

/**
 * Hub 指标
 */
export interface HubMetrics {
  uptime: number;
  totalMessages: number;
  totalAgents: number;
  activeAgents: number;
  pendingRequests: number;
  timestamp: string;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  avgMessageLatency: number;
  messagesPerSecond: number;
  cpuUsage: number;
  memoryUsage: number;
}
