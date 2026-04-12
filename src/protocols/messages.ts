/**
 * Protocols - 通信协议定义
 *
 * JSON-RPC 2.0 协议实现，用于 Hub 与 Agent 之间的通信
 */

// ============= JSON-RPC 2.0 基础类型 =============

/**
 * JSON-RPC 2.0 基础消息
 */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number;
}

/**
 * 请求消息
 */
export interface JsonRpcRequest extends JsonRpcMessage {
  method: string;
  params?: Record<string, unknown>;
}

/**
 * 成功响应消息
 */
export interface JsonRpcSuccessResponse extends JsonRpcMessage {
  result: unknown;
}

/**
 * 错误响应消息
 */
export interface JsonRpcErrorResponse extends JsonRpcMessage {
  error: JsonRpcError;
}

/**
 * 响应消息（成功或错误）
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * 错误对象
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============= 内置方法名 =============

/**
 * Hub 内置方法名
 */
export const METHODS = {
  // Agent 注册/注销
  HUB_REGISTER: 'hub.register',
  HUB_UNREGISTER: 'hub.unregister',
  HUB_STATUS: 'hub.status',
  HUB_PING: 'hub.ping',
  HUB_METRICS: 'hub.metrics',

  // Agent 间通信
  AGENT_SEND: 'agent.send',
  AGENT_REQUEST: 'agent.request',
  AGENT_RESPONSE: 'agent.response',
  AGENT_RECEIVE: 'agent.receive',

  // 广播
  BROADCAST_ALL: 'broadcast.all',
  BROADCAST_TEAM: 'broadcast.team',
  BROADCAST_EXCEPT: 'broadcast.except',

  // 生命周期
  AGENT_SPAWN: 'agent.spawn',
  AGENT_TERMINATE: 'agent.terminate',
  AGENT_RESTART: 'agent.restart',

  // 会话管理
  SESSION_CREATE: 'session.create',
  SESSION_JOIN: 'session.join',
  SESSION_LEAVE: 'session.leave',
  SESSION_GET: 'session.get',

  // Hub 控制
  HUB_SHUTDOWN: 'hub.shutdown',

  // 事件订阅
  SUBSCRIBE: 'event.subscribe',
  UNSUBSCRIBE: 'event.unsubscribe',
  EVENT: 'event'
} as const;

/**
 * 方法名类型
 */
export type MethodName = typeof METHODS[keyof typeof METHODS] | string;

// ============= 错误码 =============

/**
 * Hub 错误码
 */
export const ERROR_CODES = {
  // JSON-RPC 通用错误 (-32700 ~ -32600)
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Hub 特定错误 (-32000 ~ -32099)
  HUB_NOT_READY: -32000,
  AGENT_NOT_FOUND: -32001,
  AGENT_ALREADY_REGISTERED: -32002,
  AGENT_TIMEOUT: -32003,
  MAX_AGENTS_EXCEEDED: -32004,
  SESSION_NOT_FOUND: -32005,
  UNAUTHORIZED: -32006,
  FORBIDDEN: -32007,
  INVALID_MESSAGE: -32008,
  AGENT_NOT_CONNECTED: -32009
} as const;

/**
 * 错误码类型
 */
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// ============= 辅助函数 =============

/**
 * 判断是否为有效请求
 */
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as JsonRpcMessage).jsonrpc === '2.0' &&
    typeof (msg as JsonRpcRequest).method === 'string'
  );
}

/**
 * 判断是否为有效响应
 */
export function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as JsonRpcMessage).jsonrpc === '2.0' &&
    ('result' in msg || 'error' in msg)
  );
}

/**
 * 创建错误响应
 */
export function createErrorResponse(
  id: string | number | undefined,
  code: ErrorCode,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined && { data })
    }
  };
}

/**
 * 创建成功响应
 */
export function createSuccessResponse(
  id: string | number | undefined,
  result: unknown
): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

/**
 * 创建通知消息（无 id）
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    method,
    params
  };
}

/**
 * 创建请求消息
 */
export function createRequest(
  id: string | number,
  method: string,
  params?: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params
  };
}
