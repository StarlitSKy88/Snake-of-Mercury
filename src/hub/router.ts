/**
 * Message Router - 消息路由器
 *
 * 处理所有 Hub 消息的路由，包括内置方法和 Agent 间通信
 */

import { EventEmitter } from 'events';

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ErrorCode
} from '../protocols/messages.js';

import {
  METHODS,
  ERROR_CODES,
  createSuccessResponse,
  createErrorResponse
} from '../protocols/messages.js';

import type { AgentRegistry } from './registry.js';
import type {
  RegisterAgentRequest,
  SpawnAgentRequest,
  TerminateAgentRequest,
  AgentStatus
} from './types.js';

/**
 * 路由上下文
 */
interface RouteContext {
  sourceId: string;
  request: JsonRpcRequest;
}

/**
 * 路由结果
 */
interface RouteResult {
  response?: JsonRpcResponse;
  forwarded?: boolean;
  broadcast?: boolean;
}

/**
 * Message Router - 消息路由器
 */
export class MessageRouter extends EventEmitter {
  constructor(
    private registry: AgentRegistry,
    private messageHandler: (to: string, message: JsonRpcRequest) => void
  ) {
    super();
  }

  /**
   * 路由消息
   */
  async route(
    request: JsonRpcRequest,
    sourceId: string
  ): Promise<RouteResult> {
    const { method, params, id } = request;

    try {
      // 记录消息
      this.emit('message:received', {
        from: sourceId,
        method,
        params
      });

      // 处理 Hub 内置方法
      switch (method) {
        case METHODS.HUB_REGISTER:
          return this.handleRegister(params, sourceId, id);

        case METHODS.HUB_UNREGISTER:
          return this.handleUnregister(params, sourceId, id);

        case METHODS.HUB_PING:
          return this.handlePing(id);

        case METHODS.HUB_STATUS:
          return this.handleStatus(id);

        case METHODS.AGENT_SEND:
          return this.handleAgentSend(params, sourceId, id);

        case METHODS.AGENT_REQUEST:
          return this.handleAgentRequest(request, sourceId);

        case METHODS.BROADCAST_ALL:
          return this.handleBroadcastAll(params, sourceId);

        case METHODS.BROADCAST_TEAM:
          return this.handleBroadcastTeam(params, sourceId);

        case METHODS.AGENT_SPAWN:
          return this.handleSpawn(params, sourceId, id);

        case METHODS.AGENT_TERMINATE:
          return this.handleTerminate(params, sourceId, id);

        case METHODS.HUB_SHUTDOWN:
          return this.handleShutdown(params, sourceId, id);

        default:
          return this.handleUnknownMethod(method, id);
      }
    } catch (error) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Internal error'
        )
      };
    }
  }

  /**
   * 处理注册请求
   */
  private handleRegister(
    params: unknown,
    sourceId: string,
    id: string | number | undefined
  ): RouteResult {
    const p = params as RegisterAgentRequest;

    if (!p.name || !p.type) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required fields: name, type'
        )
      };
    }

    try {
      const info = this.registry.register({
        name: p.name,
        type: p.type,
        parentId: p.parentId,
        metadata: p.metadata
      });

      return {
        response: createSuccessResponse(id, {
          agentId: info.id,
          hubVersion: '2.0',
          sessionId: info.id
        })
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const err = error as { code: number };
        return {
          response: createErrorResponse(id, err.code as ErrorCode, error.message)
        };
      }
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Registration failed'
        )
      };
    }
  }

  /**
   * 处理注销请求
   */
  private handleUnregister(
    params: unknown,
    sourceId: string,
    id: string | number | undefined
  ): RouteResult {
    const p = params as { agentId?: string };
    const agentId = p.agentId || sourceId;

    const success = this.registry.unregister(agentId);

    return {
      response: createSuccessResponse(id, { unregistered: success })
    };
  }

  /**
   * 处理 ping
   */
  private handlePing(id: string | number | undefined): RouteResult {
    return {
      response: createSuccessResponse(id, {
        pong: true,
        timestamp: new Date().toISOString()
      })
    };
  }

  /**
   * 处理状态查询
   */
  private handleStatus(id: string | number | undefined): RouteResult {
    const agents = this.registry.getAllAgents();

    return {
      response: createSuccessResponse(id, {
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          status: a.status
        })),
        total: agents.length
      })
    };
  }

  /**
   * 处理 Agent 间消息发送（fire-and-forget）
   */
  private handleAgentSend(
    params: unknown,
    sourceId: string,
    id: string | number | undefined
  ): RouteResult {
    const p = params as { to: string; method: string; params?: Record<string, unknown> };

    if (!p.to || !p.method) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required fields: to, method'
        )
      };
    }

    // 验证目标 Agent 存在
    const target = this.registry.getAgent(p.to);
    if (!target) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.AGENT_NOT_FOUND,
          `Agent '${p.to}' not found`
        )
      };
    }

    // 转发消息给目标 Agent
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'agent.receive',
      params: {
        from: sourceId,
        method: p.method,
        params: p.params
      }
    };

    this.messageHandler(p.to, message);
    this.registry.touch(p.to);

    // 发送确认
    return {
      response: createSuccessResponse(id, { delivered: true })
    };
  }

  /**
   * 处理 Agent 间请求（带响应）
   */
  private handleAgentRequest(
    request: JsonRpcRequest,
    sourceId: string
  ): RouteResult {
    const { params, id } = request;
    const p = params as { to: string; method: string; params?: Record<string, unknown> };

    if (!p.to || !p.method) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required fields: to, method'
        )
      };
    }

    // 验证目标 Agent 存在
    const target = this.registry.getAgent(p.to);
    if (!target) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.AGENT_NOT_FOUND,
          `Agent '${p.to}' not found`
        )
      };
    }

    // 转发请求给目标 Agent，携带原始 id 以便返回响应
    const forwardedRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `req_${sourceId}_${String(id)}`, // 标记来源
      method: 'agent.request',
      params: {
        from: sourceId,
        originalId: id,
        method: p.method,
        params: p.params
      }
    };

    this.messageHandler(p.to, forwardedRequest);
    this.registry.touch(p.to);

    // 不立即返回响应，由目标 Agent 直接响应
    return { forwarded: true };
  }

  /**
   * 处理广播给所有 Agent
   */
  private handleBroadcastAll(
    params: unknown,
    sourceId: string
  ): RouteResult {
    const p = params as { method: string; params?: Record<string, unknown> };

    if (!p.method) {
      return {
        response: createErrorResponse(
          undefined,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required field: method'
        )
      };
    }

    const agents = this.registry.getAllAgents();
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'agent.receive',
      params: {
        from: sourceId,
        method: p.method,
        params: p.params,
        broadcast: true
      }
    };

    let deliveredCount = 0;
    for (const agent of agents) {
      if (agent.id !== sourceId) {
        this.messageHandler(agent.id, message);
        deliveredCount++;
      }
    }

    return {
      response: createSuccessResponse(undefined, { delivered: deliveredCount }),
      broadcast: true
    };
  }

  /**
   * 处理广播给团队（特定 Agent 组）
   */
  private handleBroadcastTeam(
    params: unknown,
    sourceId: string
  ): RouteResult {
    const p = params as { to: string[]; method: string; params?: Record<string, unknown> };

    if (!p.to || !Array.isArray(p.to) || !p.method) {
      return {
        response: createErrorResponse(
          undefined,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required fields: to (array), method'
        )
      };
    }

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'agent.receive',
      params: {
        from: sourceId,
        method: p.method,
        params: p.params,
        broadcast: true
      }
    };

    let deliveredCount = 0;
    for (const targetId of p.to) {
      if (targetId !== sourceId) {
        this.messageHandler(targetId, message);
        deliveredCount++;
      }
    }

    return {
      response: createSuccessResponse(undefined, { delivered: deliveredCount }),
      broadcast: true
    };
  }

  /**
   * 处理 Spawn 请求
   */
  private handleSpawn(
    params: unknown,
    sourceId: string,
    id: string | number | undefined
  ): RouteResult {
    const p = params as SpawnAgentRequest;

    if (!p.name || !p.type || !p.command) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required fields: name, type, command'
        )
      };
    }

    // 检查最大 Agent 数量
    if (this.registry.getAgentCount() >= 100) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.MAX_AGENTS_EXCEEDED,
          'Maximum number of agents reached'
        )
      };
    }

    // 触发 spawn 事件，由外部处理器完成实际的 spawn
    this.emit('agent:spawn_requested', {
      request: p,
      requesterId: sourceId
    });

    return {
      response: createSuccessResponse(id, {
        status: 'spawn_requested',
        parentId: sourceId
      })
    };
  }

  /**
   * 处理 Terminate 请求
   */
  private handleTerminate(
    params: unknown,
    sourceId: string,
    id: string | number | undefined
  ): RouteResult {
    const p = params as TerminateAgentRequest;

    if (!p.agentId) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.INVALID_PARAMS,
          'Missing required field: agentId'
        )
      };
    }

    const target = this.registry.getAgent(p.agentId);
    if (!target) {
      return {
        response: createErrorResponse(
          id,
          ERROR_CODES.AGENT_NOT_FOUND,
          `Agent '${p.agentId}' not found`
        )
      };
    }

    // 触发 terminate 事件，由外部处理器完成
    this.emit('agent:terminate_requested', {
      agentId: p.agentId,
      force: p.force || false,
      requesterId: sourceId
    });

    return {
      response: createSuccessResponse(id, { terminated: true })
    };
  }

  /**
   * 处理关闭 Hub 请求
   */
  private handleShutdown(
    params: unknown,
    sourceId: string,
    id: string | number | undefined
  ): RouteResult {
    this.emit('hub:shutdown_requested', { requesterId: sourceId });

    return {
      response: createSuccessResponse(id, { shutdown: true })
    };
  }

  /**
   * 处理未知方法
   */
  private handleUnknownMethod(
    method: string,
    id: string | number | undefined
  ): RouteResult {
    return {
      response: createErrorResponse(
        id,
        ERROR_CODES.METHOD_NOT_FOUND,
        `Method '${method}' not found`
      )
    };
  }
}
