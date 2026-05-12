/**
 * 内置 Middleware — Anthropic Harness 三角 + 数据驱动闭环
 *
 * 严格遵循 Anthropic 三篇工程博客 (2025.11 - 2026.04):
 *   1. Effective harnesses for long-running agents
 *   2. Harness design for long-running application development
 *   3. Scaling Managed Agents
 *
 * 核心原则:
 *   - 逐个 Sprint 顺序执行，绝不批量/并行
 *   - 逐个 acceptance criterion 验证
 *   - retry 直到全部通过（熔断替代硬编码上限）
 *   - Phase 0 接受 Marketing 数据回传，驱动多次迭代
 */

import type { Middleware, PipelineContext } from './pipeline.js';
import type { AgentDefinition, TaskResult } from '../swarm/swarm-coordinator.js';
import type { AgentEngine } from '../utils/agent-executor.js';
import { executeAgent } from '../utils/agent-executor.js';

// 动态导入
let _executePlanner: Function | null = null;
let _executeGenerator: Function | null = null;
let _executeEvaluator: Function | null = null;
let _executePhase3Delivery: Function | null = null;
let _executeHubDebate: Function | null = null;

async function getPlanner() {
  if (!_executePlanner) { const m = await import('../planner-agent.js'); _executePlanner = m.executePlanner; }
  return _executePlanner!;
}
async function getGenerator() {
  if (!_executeGenerator) { const m = await import('../generator-agent.js'); _executeGenerator = m.executeGenerator; }
  return _executeGenerator!;
}
async function getEvaluator() {
  if (!_executeEvaluator) { const m = await import('../evaluator-agent.js'); _executeEvaluator = m.executeEvaluator; }
  return _executeEvaluator!;
}
async function getDelivery() {
  if (!_executePhase3Delivery) { const m = await import('../phase3-delivery.js'); _executePhase3Delivery = m.executePhase3Delivery; }
  return _executePhase3Delivery!;
}
async function getHubDebate() {
  if (!_executeHubDebate) { const m = await import('../integrations/debate-engine-hub.js'); _executeHubDebate = m.executeHubDebate; }
  return _executeHubDebate!;
}

// ============= 辅助函数 =============

/**
 * 逐个评估每项 acceptance criterion（Anthropic 2026.03 规范）
 */
function evaluateEachCriterion(
  criteria: string[],
  report: { verdict: string; issues: string[] }
): { criterion: string; passed: boolean; reason: string }[] {
  return criteria.map(criterion => {
    const lc = criterion.toLowerCase();
    const matchedIssue = report.issues?.find(
      (issue: string) => issue.toLowerCase().includes(lc.slice(0, 10))
    );
    if (matchedIssue) return { criterion, passed: false, reason: matchedIssue };
    if (report.verdict === 'APPROVED') return { criterion, passed: true, reason: 'verdict APPROVED' };
    return { criterion, passed: false, reason: report.issues?.join('; ') || '未通过评估' };
  });
}

const PHASE0_TEMPLATE = `
# 用户原始需求
{requirement}

# 已有数据反馈（如有）
{feedbackData}

请基于以上需求和数据，生成一个标准化的 8 模块问题定义：
1. Context snapshot（上下文快照）
2. Problem statement（问题陈述 + why now）
3. JTBD（用户待办任务 + 目标人群）
4. Current alternatives + gaps（替代方案 + 缺口）
5. Evidence & assumptions log（证据 + 假设日志，字符串数组）
6. Success criteria + guardrails（成功标准 + 护栏，字符串数组）
7. Scope boundaries（范围边界 in/out，各字符串数组）
8. Prototype / learning plan（原型验证计划）

请以 JSON 格式输出。
`;

// ============= Phase 0: 需求澄清 + 辩论 =============

export function createPhase0Middleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Phase0-Debate',
    phase: 'phase0',
    agentDef: {
      id: 'agent-phase0', name: 'Phase0 Debate', role: 'analyst',
      domain: 'requirements',
      capabilities: ['debate', 'clarification', 'problem-definition', 'data-driven-iteration'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const feedbackData = ctx.feedbackData
        ? JSON.stringify(ctx.feedbackData, null, 2)
        : '暂无';

      const prompt = PHASE0_TEMPLATE
        .replace('{requirement}', ctx.convergedRequirement || ctx.requirement)
        .replace('{feedbackData}', feedbackData);

      const pdResult = await executeAgent(
        '你是一个资深产品分析师。基于需求和用户数据，输出严格 JSON 格式的问题定义。',
        prompt,
        { engine: ctx.engine, timeout: 120000 }
      );

      let problemDefinition;
      try { problemDefinition = JSON.parse(pdResult.output); } catch {
        problemDefinition = {
          contextSnapshot: ctx.requirement, problemStatement: ctx.requirement,
          jtbd: '待定义', currentAlternatives: '待分析',
          evidenceAndAssumptions: [],
          successCriteria: ['功能完整', '可正常运行'],
          scopeBoundaries: { inScope: [], outOfScope: [] },
          prototypePlan: '待规划',
        };
      }

      const debateFn = await getHubDebate();
      const debateResult = await debateFn(ctx.projectDir, problemDefinition, ((ctx.phase0Iteration as number) || 1));
      ctx.convergedRequirement = debateResult.convergedRequirement;
      ctx.debateResult = debateResult;
      ctx.phase0Iteration = ((ctx.phase0Iteration as number) || 0) + 1;
      await next();
    },
  };
}

// ============= Phase 1: Planner =============

export function createPlannerMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Planner', phase: 'phase1',
    agentDef: {
      id: 'agent-planner', name: 'Planner', role: 'planner',
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
      if (result.success) ctx.productSpec = result.spec;
      else ctx.errors.push('Planner: failed to generate product spec');
      await next();
    },
  };
}

// ============= Phase 2: Generator + Evaluator (Anthropic 逐个 Sprint + 无限重试) =============

export function createGeneratorEvaluatorMiddleware(
  engine: AgentEngine = 'minimax',
  maxGlobalIterations: number = 50,
  maxNoProgressRetries: number = 10
): Middleware {
  const sprintResults: TaskResult[] = [];
  // 跟踪每个 Sprint 的上次错误，用于针对性修复
  const sprintIssues = new Map<number, string>();

  return {
    name: 'GeneratorEvaluator', phase: 'phase2',
    agentDef: {
      id: 'agent-generator-evaluator', name: 'Generator+Evaluator', role: 'generator',
      domain: 'coding',
      capabilities: ['code-gen', 'testing', 'self-eval', 'code-review'],
      engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const gen = await getGenerator();
      const evaluator = await getEvaluator();
      const spec = ctx.productSpec as any;

      if (!spec?.sprintPlan || spec.sprintPlan.length === 0) {
        ctx.errors.push('GeneratorEvaluator: no sprint plan');
        await next();
        return;
      }

      let globalIterations = 0;

      for (const sprint of spec.sprintPlan) {
        console.log(`\n━━━ Sprint ${sprint.sprintNumber}/${spec.sprintPlan.length} ━━━`);

        let sprintPassed = false;
        let consecutiveNoProgress = 0;
        let lastIssueCount = Infinity;
        let sprintIterations = 0;

        while (!sprintPassed) {
          sprintIterations++;
          globalIterations++;

          // 熔断: 全局上限
          if (globalIterations >= maxGlobalIterations) {
            console.log(`[Ralph] ⚡ 全局迭代 ${maxGlobalIterations} 熔断`);
            sprintResults.push({ success: false, output: '', error: `Global limit at Sprint ${sprint.sprintNumber}` });
            break;
          }
          // 熔断: 连续无进展
          if (consecutiveNoProgress >= maxNoProgressRetries) {
            console.log(`[Ralph] ⚡ 连续 ${maxNoProgressRetries} 次无进展，熔断`);
            sprintResults.push({ success: false, output: '', error: `No progress after ${consecutiveNoProgress} retries` });
            break;
          }

          // Generator: 首次实现 / 根据上次 Evaluator 反馈修复
          const prevIssues = sprintIssues.get(sprint.sprintNumber);
          console.log(`[Sprint ${sprint.sprintNumber}] ${sprintIterations > 1 ? `🔧 修复 #${sprintIterations}` : '💻 实现中...'}` +
            (prevIssues ? ` 上次: ${prevIssues.slice(0, 60)}` : ''));

          const genResult = await gen({
            sprint, spec, projectDir: ctx.projectDir,
            previousIssues: prevIssues ? [prevIssues] : [],
          }, ctx.engine);

          if (!genResult.success) {
            consecutiveNoProgress++;
            console.log(`  Generator 失败: ${genResult.error}`);
            continue;
          }

          // Evaluator: 逐个 criterion 验证
          const report = await evaluator({
            sprint, spec, generatorOutput: genResult.output,
            projectDir: ctx.projectDir,
          }, ctx.engine);

          const criteriaResults = evaluateEachCriterion(
            sprint.acceptanceCriteria || [], report
          );
          const allPassed = criteriaResults.every(c => c.passed);
          const failedCriteria = criteriaResults.filter(c => !c.passed);
          const issueList = failedCriteria.map(c => `[${c.criterion}]: ${c.reason}`);

          console.log(`  通过: ${criteriaResults.filter(c => c.passed).length}/${criteriaResults.length}`);

          if (allPassed && report.verdict === 'APPROVED') {
            sprintPassed = true;
            sprintIssues.delete(sprint.sprintNumber);
            sprintResults.push({ success: true, output: genResult.output });
            console.log(`  ✅ Sprint ${sprint.sprintNumber} 通过 (${sprintIterations} 次迭代)`);
            break;
          }

          // 记录问题供下次修复
          sprintIssues.set(sprint.sprintNumber, issueList.join('; '));
          const currentIssueCount = failedCriteria.length;
          consecutiveNoProgress = currentIssueCount >= lastIssueCount ? consecutiveNoProgress + 1 : 0;
          lastIssueCount = currentIssueCount;

          for (const fc of failedCriteria) {
            console.log(`  ❌ ${fc.criterion}: ${fc.reason}`);
          }
        }

        if (!sprintPassed) break; // 当前 Sprint 熔断，停止后续
      }

      ctx.sprintResults = sprintResults;
      const passed = sprintResults.filter(r => r.success).length;
      if (passed < spec.sprintPlan.length) {
        ctx.errors.push(`GeneratorEvaluator: ${passed}/${spec.sprintPlan.length} sprints passed`);
      }
      await next();
    },
  };
}

// ============= Phase 3: Delivery =============

export function createDeliveryMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Delivery', phase: 'phase3',
    agentDef: {
      id: 'agent-delivery', name: 'Delivery', role: 'devops',
      domain: 'deployment', capabilities: ['deploy', 'canary', 'docs'], engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const delivery = await getDelivery();
      const result = await delivery(
        {
          version: '2.0', projectName: ctx.projectId, originalRequirement: ctx.requirement,
          currentPhase: 'phase3', iterationCount: ctx.phase0Iteration || 1,
          convergenceStatus: { signal: 'CONTINUE', reason: 'pipeline', consecutiveNoImprovement: 0, qualityTrend: 'stable', shouldStop: false },
          lastUpdated: new Date().toISOString(), pivotHistory: [],
        },
        ctx.projectDir, { engine: ctx.engine }
      );
      ctx.deploymentResult = result;
      if (result?.deployment?.url) ctx.deployedUrl = result.deployment.url;
      await next();
    },
  };
}

// ============= DevOps 监控 =============

export function createDevOpsMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'DevOps', phase: 'post-phase3',
    agentDef: {
      id: 'agent-devops', name: 'DevOps', role: 'devops',
      domain: 'operations', capabilities: ['monitoring', 'auto-fix', 'escalation'], engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      if (!ctx.deployedUrl) { await next(); return; }
      const { DevOpsAgent } = await import('../devops-agent.js');
      const devops = new DevOpsAgent(ctx.projectDir, ctx.engine, (incident) => {
        console.log(`[DevOps] 🚨 ${incident.description}`);
      });
      devops.registerEndpoint({
        name: ctx.projectId, url: ctx.deployedUrl as string,
        type: 'frontend', expectedStatus: 200, checkIntervalMs: 60000,
      });
      devops.startMonitoring();
      console.log(devops.getSummary());
      ctx.devopsAgent = devops;
      await next();
    },
  };
}

// ============= Marketing 数据采集 + AiToEarn + 反馈 Phase 0 =============

export function createMarketingMiddleware(engine: AgentEngine = 'minimax'): Middleware {
  return {
    name: 'Marketing', phase: 'post-phase3',
    agentDef: {
      id: 'agent-marketing', name: 'Marketing', role: 'marketing',
      domain: 'growth', capabilities: ['analytics', 'content-publishing', 'aitoearn', 'feedback-loop'], engine,
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const { MarketingAgent } = await import('../marketing-agent.js');
      const marketing = new MarketingAgent(ctx.projectDir, ctx.engine, (task) => {
        console.log(`[Marketing] 📈 ${task.title}`);
      });
      marketing.startCollecting();

      if (ctx.deployedUrl) {
        await marketing.publishContent({
          projectName: ctx.projectId,
          description: ctx.requirement.slice(0, 200),
          deployedUrl: ctx.deployedUrl as string,
        });
      }

      console.log(marketing.getSummary());
      console.log(marketing.getAiToEarnSummary());

      // 收集汇总数据作为下一次 Phase 0 迭代输入
      ctx.feedbackData = {
        summary: marketing.getSummary(),
        aitoearn: marketing.getAiToEarnSummary(),
        timestamp: new Date().toISOString(),
      };
      ctx.marketingAgent = marketing;
      await next();
    },
  };
}

// ============= Convergence =============

export function createConvergenceMiddleware(maxIterations: number = 5): Middleware {
  let iteration = 0;

  return {
    name: 'Convergence', phase: 'convergence',
    async run(ctx: PipelineContext, _next: () => Promise<void>) {
      iteration++;
      const sprintResults = ctx.sprintResults || [];
      const passedCount = sprintResults.filter(r => r.success).length;
      const totalCount = sprintResults.length || 1;

      if (ctx.feedbackData && iteration < maxIterations) {
        ctx.shouldStop = false;
        console.log(`[Convergence] 🔄 数据驱动迭代 ${iteration + 1}/${maxIterations}`);
        return;
      }
      if (passedCount === totalCount && totalCount > 0) {
        ctx.shouldStop = true;
        console.log(`[Convergence] ✅ 全部通过 (${passedCount}/${totalCount})`);
      } else if (iteration >= maxIterations) {
        ctx.shouldStop = true;
        console.log(`[Convergence] ⏰ ${maxIterations} 次上限`);
      } else if (passedCount === 0) {
        ctx.shouldStop = true;
        console.log('[Convergence] ❌ 无 Sprint 通过');
      } else {
        ctx.shouldStop = false;
        console.log(`[Convergence] 🔄 继续 ${iteration + 1}/${maxIterations} (${passedCount}/${totalCount})`);
      }
    },
  };
}

// ============= 构建完整管道 =============

export function createDefaultPipeline(engine: AgentEngine = 'minimax'): Middleware[] {
  return [
    createPhase0Middleware(engine),
    createPlannerMiddleware(engine),
    createGeneratorEvaluatorMiddleware(engine, 50, 10),
    createDeliveryMiddleware(engine),
    createDevOpsMiddleware(engine),
    createMarketingMiddleware(engine),
    createConvergenceMiddleware(5),
  ];
}
