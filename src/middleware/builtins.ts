/**
 * 内置 Middleware — 包装现有 Agent 函数为管道中间件
 *
 * Phase 0: 需求澄清 + 辩论引擎
 * Phase 1: Planner → 产品规格
 * Phase 2: Generator → Evaluator (Ralph Loop 重试)
 * Phase 3: Delivery + DevOps + Marketing
 * Convergence: 收敛检测
 */

import type { Middleware, PipelineContext } from './pipeline.js';
import type { AgentDefinition, TaskResult } from '../swarm/swarm-coordinator.js';
import type { AgentEngine } from '../utils/agent-executor.js';
import { executeAgent } from '../utils/agent-executor.js';

// 动态导入避免循环依赖
let _executePlanner: Function | null = null;
let _executeGenerator: Function | null = null;
let _executeEvaluator: Function | null = null;
let _executePhase3Delivery: Function | null = null;
let _executeHubDebate: Function | null = null;

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
async function getHubDebate() {
  if (!_executeHubDebate) {
    const mod = await import('../integrations/debate-engine-hub.js');
    _executeHubDebate = mod.executeHubDebate;
  }
  return _executeHubDebate!;
}

const PHASE0_TEMPLATE = `
# 用户原始需求
{requirement}

请基于以上需求，生成一个标准化的 8 模块问题定义：
1. Context snapshot（上下文快照）
2. Problem statement（问题陈述 + why now）
3. JTBD（用户待办任务 + 目标人群）
4. Current alternatives + gaps（替代方案 + 缺口）
5. Evidence & assumptions log（证据 + 假设日志，字符串数组）
6. Success criteria + guardrails（成功标准 + 护栏，字符串数组）
7. Scope boundaries（范围边界 in/out，各字符串数组）
8. Prototype / learning plan（原型验证计划）

请以 JSON 格式输出。字段名:
contextSnapshot, problemStatement, jtbd, currentAlternatives, evidenceAndAssumptions, successCriteria, scopeBoundaries: { inScope, outScope }, prototypePlan
`;

// ============= Phase 0: 需求澄清 + 辩论 =============

export function createPhase0Middleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Phase0-Debate',
    phase: 'phase0',
    agentDef: {
      id: 'agent-phase0',
      name: 'Phase0 Debate',
      role: 'analyst',
      domain: 'requirements',
      capabilities: ['debate', 'clarification', 'problem-definition'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      // Step 1: 从需求生成 ProblemDefinition
      const prompt = PHASE0_TEMPLATE.replace('{requirement}', ctx.requirement);
      const pdResult = await executeAgent(
        '你是一个资深产品分析师。请输出严格 JSON 格式。',
        prompt,
        { engine: ctx.engine, timeout: 120000 }
      );

      let problemDefinition;
      try {
        problemDefinition = JSON.parse(pdResult.output);
      } catch {
        problemDefinition = {
          contextSnapshot: ctx.requirement,
          problemStatement: ctx.requirement,
          jtbd: '待定义',
          currentAlternatives: '待分析',
          evidenceAndAssumptions: [],
          successCriteria: ['功能完整', '可正常运行'],
          scopeBoundaries: { inScope: [], outOfScope: [] },
          prototypePlan: '待规划',
        };
      }

      // Step 2: 执行 5 Agent 辩论
      const debateFn = await getHubDebate();
      const debateResult = await debateFn(ctx.projectDir, problemDefinition, 1);
      ctx.convergedRequirement = debateResult.convergedRequirement;
      ctx.debateResult = debateResult;

      await next();
    },
  };
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
      } else {
        ctx.errors.push('Planner: failed to generate product spec');
      }
      await next();
    },
  };
}

// ============= Phase 2: Generator + Evaluator (Ralph Loop) =============

export function createGeneratorEvaluatorMiddleware(
  engine: AgentEngine = 'minimax',
  maxRetries: number = 3
): Middleware {
  const sprintResults: TaskResult[] = [];

  return {
    name: 'GeneratorEvaluator',
    phase: 'phase2',
    agentDef: {
      id: 'agent-generator-evaluator',
      name: 'Generator+Evaluator',
      role: 'generator',
      domain: 'coding',
      capabilities: ['code-gen', 'testing', 'self-eval', 'code-review'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const gen = await getGenerator();
      const evaluator = await getEvaluator();
      const spec = ctx.productSpec as any;

      if (!spec?.sprintPlan) {
        ctx.errors.push('GeneratorEvaluator: no sprint plan');
        await next();
        return;
      }

      for (const sprint of spec.sprintPlan) {
        let passed = false;
        let lastError = '';

        // Ralph Loop: 每个 Sprint 最多重试 maxRetries 次
        for (let attempt = 0; attempt < maxRetries && !passed; attempt++) {
          const genResult = await gen({
            sprint,
            spec,
            projectDir: ctx.projectDir,
            previousIssues: attempt > 0 ? [lastError] : [],
          }, ctx.engine);

          if (!genResult.success) {
            lastError = genResult.error || 'Generator failed';
            continue;
          }

          const report = await evaluator({
            sprint,
            spec,
            generatorOutput: genResult.output,
            projectDir: ctx.projectDir,
          }, ctx.engine);

          if (report.verdict === 'APPROVED') {
            passed = true;
            sprintResults.push({
              success: true,
              output: genResult.output,
            });
          } else {
            lastError = report.issues?.join('; ') || 'Evaluator rejected';
            if (attempt < maxRetries - 1) {
              console.log(`[Ralph] Sprint ${sprint.sprintNumber} 重试 ${attempt + 1}/${maxRetries}: ${lastError.slice(0, 80)}`);
            }
          }
        }

        if (!passed) {
          sprintResults.push({
            success: false,
            output: '',
            error: `Failed after ${maxRetries} attempts: ${lastError}`,
          });
        }
      }

      ctx.sprintResults = sprintResults;
      const passedCount = sprintResults.filter(r => r.success).length;
      if (passedCount < spec.sprintPlan.length) {
        ctx.errors.push(
          `GeneratorEvaluator: ${passedCount}/${spec.sprintPlan.length} sprints passed`
        );
      }
      await next();
    },
  };
}

// ============= Phase 3: Delivery + DevOps + Marketing =============

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
          convergenceStatus: { signal: 'CONTINUE', reason: 'pipeline', consecutiveNoImprovement: 0, qualityTrend: 'stable', shouldStop: false },
          lastUpdated: new Date().toISOString(),
          pivotHistory: [],
        },
        ctx.projectDir,
        { engine: ctx.engine }
      );

      ctx.deploymentResult = result;

      // 存储部署 URL 供 DevOps/Marketing 使用
      if (result?.deployment?.url) {
        ctx.deployedUrl = result.deployment.url;
      }

      await next();
    },
  };
}

// ============= Post-Phase 3: DevOps 监控 =============

export function createDevOpsMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'DevOps',
    phase: 'post-phase3',
    agentDef: {
      id: 'agent-devops',
      name: 'DevOps',
      role: 'devops',
      domain: 'operations',
      capabilities: ['monitoring', 'auto-fix', 'escalation'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      if (!ctx.deployedUrl) {
        await next();
        return;
      }

      // 动态导入 DevOpsAgent
      const { DevOpsAgent } = await import('../devops-agent.js');

      const devops = new DevOpsAgent(ctx.projectDir, ctx.engine, (incident) => {
        console.log(`[DevOps] 🚨 升级事件: ${incident.description}`);
      });

      devops.registerEndpoint({
        name: ctx.projectId,
        url: ctx.deployedUrl as string,
        type: 'frontend',
        expectedStatus: 200,
        checkIntervalMs: 60000,
      });

      devops.startMonitoring();
      console.log(devops.getSummary());

      // 将 devops 实例存储到 context，供外部关闭
      ctx.devopsAgent = devops;

      await next();
    },
  };
}

// ============= Post-Phase 3: Marketing 数据采集 + AiToEarn =============

export function createMarketingMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Marketing',
    phase: 'post-phase3',
    agentDef: {
      id: 'agent-marketing',
      name: 'Marketing',
      role: 'marketing',
      domain: 'growth',
      capabilities: ['analytics', 'content-publishing', 'aitoearn'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const { MarketingAgent } = await import('../marketing-agent.js');

      const marketing = new MarketingAgent(ctx.projectDir, ctx.engine, (task) => {
        console.log(`[Marketing] 📈 优化任务: ${task.title}`);
      });

      marketing.startCollecting();

      // 如果有部署 URL，发布推广内容
      if (ctx.deployedUrl) {
        await marketing.publishContent({
          projectName: ctx.projectId,
          description: ctx.requirement.slice(0, 200),
          deployedUrl: ctx.deployedUrl as string,
        });
      }

      console.log(marketing.getSummary());
      console.log(marketing.getAiToEarnSummary());

      ctx.marketingAgent = marketing;
      await next();
    },
  };
}

// ============= Convergence: 收敛检测 =============

export function createConvergenceMiddleware(
  maxIterations: number = 5
): Middleware {
  let iteration = 0;

  return {
    name: 'Convergence',
    phase: 'convergence',
    async run(ctx: PipelineContext, _next: () => Promise<void>) {
      iteration++;

      const sprintResults = ctx.sprintResults || [];
      const passedCount = sprintResults.filter(r => r.success).length;
      const totalCount = sprintResults.length || 1;

      // 简单收敛逻辑: 所有 sprint 通过 → 停止
      if (passedCount === totalCount && totalCount > 0) {
        ctx.shouldStop = true;
        console.log(`[Convergence] ✅ 全部 Sprint 通过 (${passedCount}/${totalCount})`);
      } else if (iteration >= maxIterations) {
        ctx.shouldStop = true;
        console.log(`[Convergence] ⏰ 达到最大迭代次数 (${maxIterations})`);
      } else if (passedCount === 0) {
        ctx.shouldStop = true;
        console.log('[Convergence] ❌ 无 Sprint 通过，停止');
      } else {
        ctx.shouldStop = false;
        console.log(`[Convergence] 🔄 继续迭代 ${iteration + 1}/${maxIterations} (${passedCount}/${totalCount} 通过)`);
      }
    },
  };
}

// ============= 构建完整管道 =============

export function createDefaultPipeline(engine: AgentEngine = 'minimax'): Middleware[] {
  return [
    createPhase0Middleware(engine),
    createPlannerMiddleware(engine),
    createGeneratorEvaluatorMiddleware(engine, 3),
    createDeliveryMiddleware(engine),
    createDevOpsMiddleware(engine),
    createMarketingMiddleware(engine),
    createConvergenceMiddleware(5),
  ];
}
