/**
 * 内置 Middleware — 包装现有 Agent 函数为管道中间件
 * 
 * 每个 Middleware:
 * - 有独立 Agent 身份（注册到 SwarmCoordinator）
 * - 通过 PipelineContext 通信（不是直接函数调用）
 * - 发射 EventBus 事件
 * - 持久化到 AgentMemory
 */

import type { Middleware, PipelineContext } from './pipeline.js';
import type { AgentDefinition, TaskResult } from '../swarm/swarm-coordinator.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// 动态导入避免循环依赖
let _executePlanner: Function | null = null;
let _executeGenerator: Function | null = null;
let _executeEvaluator: Function | null = null;
let _executePhase3Delivery: Function | null = null;

async function getPlanner() {
  if (!_executePlanner) {
    const mod = await import('../planner-agent.js');
    _executePlanner = mod.executePlanner;
  }
  return _executePlanner!;
}
async function getGenerator() {
  if (!_executeGenerator) {
    const mod = await import('../generator-agent.js');
    _executeGenerator = mod.executeGenerator;
  }
  return _executeGenerator!;
}
async function getEvaluator() {
  if (!_executeEvaluator) {
    const mod = await import('../evaluator-agent.js');
    _executeEvaluator = mod.executeEvaluator;
  }
  return _executeEvaluator!;
}
async function getDelivery() {
  if (!_executePhase3Delivery) {
    const mod = await import('../phase3-delivery.js');
    _executePhase3Delivery = mod.executePhase3Delivery;
  }
  return _executePhase3Delivery!;
}

// ============= Phase 1: Planner Middleware =============

export function createPlannerMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Planner',
    phase: 'phase1',
    agentDef: {
      id: 'agent-planner',
      name: 'Planner',
      role: 'planner',
      domain: 'planning',
      capabilities: ['product-spec', 'sprint-planning', 'moSCoW'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const planner = await getPlanner();
      const result = await planner({
        originalRequirement: ctx.convergedRequirement || ctx.requirement,
        projectDir: ctx.projectDir,
      }, ctx.engine);

      if (result.success) {
        ctx.productSpec = result.spec;
      }
      await next();
    },
  };
}

// ============= Phase 2: Generator Middleware =============

export function createGeneratorMiddleware(
  engine: AgentEngine = 'minimax',
  sprintResults: TaskResult[] = []
): Middleware {
  return {
    name: 'Generator',
    phase: 'phase2',
    agentDef: {
      id: 'agent-generator',
      name: 'Generator',
      role: 'generator',
      domain: 'coding',
      capabilities: ['code-gen', 'testing', 'self-eval'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const gen = await getGenerator();
      const spec = ctx.productSpec as any;
      if (!spec?.sprintPlan) {
        ctx.errors.push('Generator: no sprint plan from Planner');
        await next();
        return;
      }

      for (const sprint of spec.sprintPlan) {
        const result = await gen({
          sprint,
          spec,
          projectDir: ctx.projectDir,
        }, ctx.engine);

        sprintResults.push({
          success: result.success,
          output: result.output,
          error: result.success ? undefined : 'Generator failed',
        });
      }

      ctx.sprintResults = sprintResults;
      await next();
    },
  };
}

// ============= Phase 2: Evaluator Middleware =============

export function createEvaluatorMiddleware(
  engine: AgentEngine = 'minimax',
  sprintResults: TaskResult[] = []
): Middleware {
  return {
    name: 'Evaluator',
    phase: 'phase2',
    agentDef: {
      id: 'agent-evaluator',
      name: 'Evaluator',
      role: 'evaluator',
      domain: 'reviewing',
      capabilities: ['code-review', 'quality-scoring', 'hard-threshold'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const evaluator = await getEvaluator();
      const spec = ctx.productSpec as any;

      if (!spec?.sprintPlan || sprintResults.length === 0) {
        await next();
        return;
      }

      let allPassed = true;
      for (let i = 0; i < spec.sprintPlan.length; i++) {
        const sprint = spec.sprintPlan[i];
        const genResult = sprintResults[i];
        if (!genResult?.success) continue;

        const report = await evaluator({
          sprint,
          spec,
          generatorOutput: genResult.output,
          projectDir: ctx.projectDir,
        }, ctx.engine);

        if (report.verdict !== 'APPROVED') {
          allPassed = false;
          sprintResults[i] = {
            success: false,
            output: genResult.output,
            error: report.issues.join('; '),
          };
        }
      }

      if (!allPassed) {
        ctx.errors.push('Evaluator: some sprints failed hard threshold');
      }
      ctx.sprintResults = sprintResults;
      await next();
    },
  };
}

// ============= Phase 3: Delivery Middleware =============

export function createDeliveryMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Delivery',
    phase: 'phase3',
    agentDef: {
      id: 'agent-delivery',
      name: 'Delivery',
      role: 'devops',
      domain: 'deployment',
      capabilities: ['deploy', 'canary', 'docs'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const delivery = await getDelivery();
      const result = await delivery(
        {
          version: '2.0',
          projectName: ctx.projectId,
          originalRequirement: ctx.requirement,
          currentPhase: 'phase3',
          iterationCount: 1,
          convergenceStatus: { signal: 'STOP', reason: 'pipeline', consecutiveNoImprovement: 0, qualityTrend: 'stable', shouldStop: true },
          lastUpdated: new Date().toISOString(),
          pivotHistory: [],
        },
        ctx.projectDir,
        { engine: ctx.engine }
      );

      ctx.deploymentResult = result;
      await next();
    },
  };
}

// ============= 辅助: 构建完整管道 =============

export function createDefaultPipeline(engine: AgentEngine = 'minimax'): Middleware[] {
  const sprintResults: TaskResult[] = [];

  return [
    createPlannerMiddleware(engine),
    createGeneratorMiddleware(engine, sprintResults),
    createEvaluatorMiddleware(engine, sprintResults),
    createDeliveryMiddleware(engine),
  ];
}
