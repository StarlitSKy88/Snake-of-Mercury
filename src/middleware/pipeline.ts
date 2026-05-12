/**
 * Middleware Pipeline — 可组合的 Agent 执行管道
 *
 * 学习自 DeerFlow 的 Middleware 模式 + Anthropic Harness 三角
 *
 * 核心思想:
 * - 每个 Phase 是一个 Middleware，可独立注册/替换/移除
 * - Pipeline 按顺序执行，前一个的输出是后一个的输入
 * - SwarmCoordinator 管理每个 Middleware 的生命周期
 * - 支持外循环：Convergence 中间件设置 shouldStop=false → 重新执行
 *
 * 对比旧架构:
 *   旧: harness-scheduler.ts 硬编码 652 行 if/else
 *   新: Pipeline.add([...middlewares]).run(input)
 */

import { writeFileSync } from 'fs';
import { join as pathJoin } from 'path';
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
  /** Phase 0 输出 */
  convergedRequirement?: string;
  debateResult?: Record<string, unknown>;
  /** Phase 1 输出: 产品规格 */
  productSpec?: Record<string, unknown>;
  /** Phase 2 输出: Sprint 结果 */
  sprintResults?: TaskResult[];
  /** Phase 3 输出 */
  deploymentResult?: Record<string, unknown>;
  deployedUrl?: string;
  /** 外部 Agent 实例 */
  devopsAgent?: unknown;
  marketingAgent?: unknown;
  /** Convergence: 是否停止外循环 */
  shouldStop?: boolean;
  /** 错误信息 */
  errors: string[];
  /** 任意扩展数据 */
  [key: string]: unknown;
}

/** 中间件接口 */
export interface Middleware {
  name: string;
  phase: string;
  agentDef?: AgentDefinition;
  run(ctx: PipelineContext, next: () => Promise<void>): Promise<void>;
}

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
      { projectId, topology: 'hierarchical', maxAgents: 15 },
      this.eventBus,
      this.memory
    );
  }

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    if (middleware.agentDef) {
      this.swarm.registerAgent(middleware.agentDef);
    }
    return this;
  }

  useAll(middlewares: Middleware[]): this {
    for (const m of middlewares) this.use(m);
    return this;
  }

  /** 执行管道（单次） */
  async runOnce(requirement: string, projectDir: string, engine: AgentEngine = 'minimax'): Promise<PipelineContext> {
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

    this.memory.put({
      namespace: ctx.projectId,
      type: 'context',
      key: 'pipeline:start',
      content: `Pipeline started: ${requirement.slice(0, 100)}`,
      metadata: { engine, timestamp: new Date().toISOString() },
    });

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index >= this.middlewares.length) return;
      const middleware = this.middlewares[index++];

      ctx.currentPhase = middleware.phase;

      this.eventBus.emit('phase:started', 'pipeline', {
        phase: middleware.phase, middleware: middleware.name,
        projectId: ctx.projectId,
      });

      if (middleware.agentDef) {
        this.swarm.heartbeat(middleware.agentDef.id);
      }

      try {
        await middleware.run(ctx, executeNext);

        this.eventBus.emit('phase:completed', 'pipeline', {
          phase: middleware.phase, middleware: middleware.name,
          projectId: ctx.projectId,
        });
        try { writeFileSync(pathJoin(ctx.projectDir, '.pipeline-state.json'), JSON.stringify({lastPhase: middleware.phase, updatedAt: new Date().toISOString()})); } catch {}

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

        await executeNext();
      }
    };

    await executeNext();

    if (ctx.shouldStop !== false) {
      this.status = ctx.errors.length === 0 ? 'completed' : 'failed';
      this.swarm.stopHeartbeatMonitor();
    }

    this.memory.put({
      namespace: ctx.projectId,
      type: 'context',
      key: 'pipeline:end',
      content: `Pipeline ${this.status}: ${ctx.errors.length} errors, shouldStop=${ctx.shouldStop}`,
      metadata: { status: this.status, errorCount: ctx.errors.length },
    });

    return ctx;
  }

  /** 执行管道（带外循环） */
  async run(requirement: string, projectDir: string, engine: AgentEngine = 'minimax'): Promise<PipelineContext> {
    let ctx: PipelineContext;
    let iteration = 0;
    const maxIterations = 5;

    do {
      iteration++;
      console.log(`\n🔄 Pipeline 外循环 迭代 ${iteration}/${maxIterations}`);
      ctx = await this.runOnce(requirement, projectDir, engine);

      if (!ctx.shouldStop && iteration < maxIterations && this.status === 'running') {
        console.log(`[Pipeline] 准备下一次迭代...`);
        // 清理单次运行状态但保留关键输出
        ctx.errors = [];
      }
    } while (!ctx.shouldStop && iteration < maxIterations && this.status === 'running');

    // 停止心跳
    this.swarm.stopHeartbeatMonitor();

    // 清理 DevOps / Marketing
    const devops = ctx.devopsAgent as { stopMonitoring?: () => void } | undefined;
    const marketing = ctx.marketingAgent as { stopCollecting?: () => void } | undefined;
    devops?.stopMonitoring?.();
    marketing?.stopCollecting?.();

    this.status = ctx.errors.length === 0 ? 'completed' : 'failed';

    return ctx;
  }

  summary(): string {
    const agents = this.swarm.getState().agents.size;
    const active = this.swarm.getState().activeAgents;
    return `🔗 Pipeline [${this.status}]
${this.middlewares.map(m => `  ${m.phase}: ${m.name}`).join('\n')}
🐝 Swarm: ${active}/${agents} agents`;
  }

  shutdown(): void {
    this.swarm.shutdown();
  }
}
