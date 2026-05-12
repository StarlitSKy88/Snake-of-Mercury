/**
 * Middleware Pipeline — 可组合的 Agent 执行管道
 * 
 * 学习自 DeerFlow 的 Middleware 模式 + Anthropic Harness 三角
 * 
 * 核心思想:
 * - 每个 Phase 是一个 Middleware，可独立注册/替换/移除
 * - Pipeline 按顺序执行，前一个的输出是后一个的输入
 * - 每个 Middleware 通过 EventBus 通信（不是直接函数调用）
 * - SwarmCoordinator 管理每个 Middleware 的生命周期
 * 
 * 对比旧架构:
 *   旧: harness-scheduler.ts 硬编码 652 行 if/else
 *   新: Pipeline.add([middleware1, middleware2, ...]).run(input)
 */

import { EventBus, type EventType } from '../event-bus.js';
import { SwarmCoordinator, type AgentDefinition, type TaskResult } from '../swarm/swarm-coordinator.js';
import { AgentMemory } from '../memory/agent-memory.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============= 类型 =============

/** Pipeline 上下文——在中间件之间传递的共享状态 */
export interface PipelineContext {
  /** 原始需求 */
  requirement: string;
  /** 项目 ID */
  projectId: string;
  /** 项目目录 */
  projectDir: string;
  /** LLM 引擎 */
  engine: AgentEngine;
  /** 当前阶段 */
  currentPhase: string;
  /** Phase 0 输出: 收敛需求 */
  convergedRequirement?: string;
  /** Phase 1 输出: 产品规格 */
  productSpec?: Record<string, unknown>;
  /** Phase 2 输出: Sprint 结果 */
  sprintResults?: TaskResult[];
  /** Phase 3 输出: 部署结果 */
  deploymentResult?: Record<string, unknown>;
  /** 错误信息 */
  errors: string[];
  /** 任意扩展数据 */
  [key: string]: unknown;
}

/** 中间件接口 */
export interface Middleware {
  /** 唯一名称 */
  name: string;
  /** 所属阶段 */
  phase: string;
  /** Agent 定义（注册到 SwarmCoordinator） */
  agentDef?: AgentDefinition;
  /** 执行中间件 */
  run(ctx: PipelineContext, next: () => Promise<void>): Promise<void>;
}

/** Pipeline 状态 */
export type PipelineStatus = 'idle' | 'running' | 'completed' | 'failed';

// ============= Pipeline =============

export class Pipeline {
  private middlewares: Middleware[] = [];
  private eventBus: EventBus;
  swarm: SwarmCoordinator;
  memory: AgentMemory;
  status: PipelineStatus = 'idle';

  constructor(projectId: string, baseDir: string) {
    this.eventBus = new EventBus(baseDir);
    this.memory = new AgentMemory(baseDir + '/.memory');
    this.swarm = new SwarmCoordinator(
      { projectId, topology: 'hierarchical', maxAgents: 10 },
      this.eventBus,
      this.memory
    );
  }

  /** 注册中间件 */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    // 注册为 Swarm Agent
    if (middleware.agentDef) {
      this.swarm.registerAgent(middleware.agentDef);
    }
    return this;
  }

  /** 批量注册 */
  useAll(middlewares: Middleware[]): this {
    for (const m of middlewares) this.use(m);
    return this;
  }

  /** 执行管道 */
  async run(requirement: string, projectDir: string, engine: AgentEngine = 'minimax'): Promise<PipelineContext> {
    const ctx: PipelineContext = {
      requirement,
      projectId: this.swarm.getState().projectId,
      projectDir,
      engine,
      currentPhase: 'init',
      errors: [],
    };

    this.status = 'running';
    this.swarm.startHeartbeatMonitor();

    // 持久化开始
    this.memory.put({
      namespace: ctx.projectId,
      type: 'context',
      key: 'pipeline:start',
      content: `Pipeline started: ${requirement.slice(0, 100)}`,
      metadata: { engine, timestamp: new Date().toISOString() },
    });

    // 构建执行链
    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index >= this.middlewares.length) return;
      const middleware = this.middlewares[index++];
      
      ctx.currentPhase = middleware.phase;
      
      this.eventBus.emit('phase:started', 'pipeline', {
        phase: middleware.phase, middleware: middleware.name,
        projectId: ctx.projectId,
      });

      // 心跳
      if (middleware.agentDef) {
        this.swarm.heartbeat(middleware.agentDef.id);
      }

      try {
        await middleware.run(ctx, executeNext);
        
        this.eventBus.emit('phase:completed', 'pipeline', {
          phase: middleware.phase, middleware: middleware.name,
          projectId: ctx.projectId,
        });

        // 记录成功
        this.memory.put({
          namespace: ctx.projectId,
          type: 'task_result',
          key: `phase:${middleware.phase}`,
          content: `✅ ${middleware.name}: completed`,
          metadata: { phase: middleware.phase },
        });

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        ctx.errors.push(`${middleware.name}: ${errMsg}`);

        this.eventBus.emit('system:error', 'pipeline', {
          phase: middleware.phase, middleware: middleware.name,
          error: errMsg, projectId: ctx.projectId,
        });

        this.memory.put({
          namespace: ctx.projectId,
          type: 'anti_pattern',
          key: `error:${middleware.phase}`,
          content: `❌ ${middleware.name}: ${errMsg}`,
          metadata: { phase: middleware.phase, error: errMsg },
        });

        // 继续执行下一个（不阻断管道）
        await executeNext();
      }
    };

    await executeNext();

    this.status = ctx.errors.length === 0 ? 'completed' : 'failed';
    this.swarm.stopHeartbeatMonitor();

    // 持久化完成
    this.memory.put({
      namespace: ctx.projectId,
      type: 'context',
      key: 'pipeline:end',
      content: `Pipeline ${this.status}: ${ctx.errors.length} errors`,
      metadata: { status: this.status, errorCount: ctx.errors.length },
    });

    return ctx;
  }

  /** 摘要 */
  summary(): string {
    return `🔗 Pipeline [${this.status}]
${this.middlewares.map(m => `  ${m.phase}: ${m.name}`).join('\n')}
🐝 Swarm: ${this.swarm.getState().activeAgents} active`;
  }

  /** 关闭 */
  shutdown(): void {
    this.swarm.shutdown();
  }
}
