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
import { executeCode, formatEvidenceForEvaluator } from './code-executor.js';
import { THREE_RED_LINES } from '../pua-constraints.js';

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
5. Evidence & assumptions log（证据 + 假设日志，每个条目必须标注 [证据] 或 [假设] 前缀）
   - [证据] 标记：来自 feedbackData 或可验证的事实
   - [假设] 标记：你的推断，需注明推理依据
6. Success criteria + guardrails（成功标准 + 护栏，字符串数组）
7. Scope boundaries（范围边界 in/out，各字符串数组）
8. Prototype / learning plan（原型验证计划）

## 关键约束
- 如果你没有相关数据，请在对应字段标注"数据不足，以下为基于经验的推断 [假设]"
- 禁止凭空编造市场数据、用户数据
- 每个 success criteria 必须是可测试的（不能是模糊的"用户体验好"）

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

      const phase0SystemPrompt = '你是一个严谨的产品分析师，专门为AI自动化开发项目做需求澄清。\n\n' +
        '## 你的核心原则\n' +
        '1. **区分事实与假设**：每个判断必须标注是来自数据([证据])还是你的推断([假设])\n' +
        '2. **宁可留白也不编造**：数据不足时明确标注"数据不足"，不要凭空填充\n' +
        '3. **关注可测试性**：所有成功标准必须可验证（不是"用户体验好"这种模糊表述）\n\n' +
        '## 输出规则\n' +
        '- 严格 JSON 格式\n' +
        '- Evidence & assumptions 数组的每个元素以 [证据] 或 [假设] 开头\n' +
        '- Success criteria 必须是具体、可测量、可验证的\n\n' +
        THREE_RED_LINES;

      const pdResult = await executeAgent(
        phase0SystemPrompt,
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
      
      // Phase0 降级: 如果收敛需求是错误消息，使用原始需求
      const converged = debateResult.convergedRequirement || '';
      if (converged.startsWith('[Error]') || converged.includes('SDK 执行失败') || converged.includes('API 不可用') || converged.length < 20) {
        console.warn('[Phase0] ⚠️ 辩论引擎失败，降级使用原始需求');
        ctx.convergedRequirement = ctx.requirement;
      } else {
        ctx.convergedRequirement = converged;
      }
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

// ============= Init: 项目初始化 (Anthropic Article 1.1) =============

export function createInitMiddleware(engine: AgentEngine = "minimax"): Middleware {
  return {
    name: "Init", phase: "init",
    agentDef: { id: "agent-init", name: "Initializer", role: "initializer", domain: "environment", capabilities: ["init-sh", "progress-file"], engine },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      const spec = ctx.productSpec as any;
      const tech = spec?.technicalDirection || "Node.js + TypeScript";
      const count = spec?.sprintPlan?.length || 1;
      const { generateInitSh, generateProgressFile } = await import("../initializer.js");
      console.log(`[Init] ✅ init.sh → ${generateInitSh(ctx.projectDir, tech)}`);
      console.log(`[Init] ✅ progress.json → ${generateProgressFile(ctx.projectDir, ctx.requirement, count)} (${count} Sprints)`);
      await next();
    },
  };
}

export function createGeneratorEvaluatorMiddleware(
  engine: AgentEngine = 'minimax',
  maxGlobalIterations: number = 50,
  maxNoProgressRetries: number = 10
): Middleware {
  const sprintResults: TaskResult[] = [];
  // 跟踪每个 Sprint 的上次错误，用于针对性修复
  const sprintIssues = new Map<number, string>();

  let apiCallCount = 0;
  const costLog: string[] = [];

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
          const { updateProgressSprint } = await import("../initializer.js");
          updateProgressSprint(ctx.projectDir, sprint.sprintNumber, { status: "in_progress" });
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
          // PUA: 连续失败时注入问责压力
          const { buildPressurePrompt } = await import("../pua-constraints.js");
          const pressureNote = buildPressurePrompt(sprint.sprintNumber, consecutiveNoProgress, maxNoProgressRetries);
          if (pressureNote) console.log(pressureNote);
          const prevIssues = sprintIssues.get(sprint.sprintNumber);
          console.log(`[Sprint ${sprint.sprintNumber}] ${sprintIterations > 1 ? `🔧 修复 #${sprintIterations}` : '💻 实现中...'}` +
            (prevIssues ? ` 上次: ${prevIssues.slice(0, 200)}` : ''));

          // Sprint Contract 谈判（首次或重谈）
          const { negotiateSprintContract } = await import("../generator-agent.js");
          const sprintContract = sprintIterations === 1
            ? await negotiateSprintContract(sprint, spec, ctx.engine)
            : (ctx as any)._sprintContract || sprint.objectives.join('; ');
          (ctx as any)._sprintContract = sprintContract;

          const genResult = await gen({
            sprint, spec, projectDir: ctx.projectDir,
            previousIssues: prevIssues ? [prevIssues] : [],
            sprintContract,
          }, ctx.engine);

          apiCallCount++;
          costLog.push(`[API#${apiCallCount}] Generator Sprint${sprint.sprintNumber} iter${sprintIterations}`);

          if (!genResult.success) {
            consecutiveNoProgress++;
            console.log(`  Generator 失败: ${genResult.error}`);
            continue;
          }

          // CodeExecutor: 提取代码 → 写盘 → 执行 → 收集真实证据
          console.log(`  ⚡ [CodeExecutor] 执行代码...`);
          let evidence = '';
          try {
            const execEvidence = await executeCode(genResult.output, ctx.projectDir);
            evidence = formatEvidenceForEvaluator(execEvidence);
            console.log(`  ⚡ [CodeExecutor] ${execEvidence.summary}`);
          } catch (err) {
            console.warn(`  ⚡ [CodeExecutor] 执行失败: ${err}`);
            evidence = '\n\n---\n## ⚡ 实际执行证据\nCodeExecutor 执行失败，以下为 Generator 自述。\n';
          }

          // 将真实验证证据附加到 Generator 输出
          const outputWithEvidence = genResult.output + evidence;

          // Evaluator: 逐个 criterion 验证（现在有真实证据可以核实！）
          apiCallCount++;
          costLog.push(`[API#${apiCallCount}] Evaluator Sprint${sprint.sprintNumber} iter${sprintIterations}`);
          const report = await evaluator({
            sprint, spec, generatorOutput: outputWithEvidence,
            projectDir: ctx.projectDir,
            sprintContract: (ctx as any)._sprintContract,
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
            sprintResults.push({ success: true, output: outputWithEvidence });
            console.log(`  ✅ Sprint ${sprint.sprintNumber} 通过 (${sprintIterations} 次迭代)`);
            updateProgressSprint(ctx.projectDir, sprint.sprintNumber, { status: "passed", iterations: sprintIterations });
            
            // 状态持久化：保存 Pipeline 进度（崩溃后可恢复）
            try {
              const { writeFileSync: wfs, mkdirSync: mds } = await import('fs');
              const { join: jn } = await import('path');
              const stateDir = jn(ctx.projectDir, '.pipeline-state');
              mds(stateDir, { recursive: true });
              wfs(jn(stateDir, 'checkpoint.json'), JSON.stringify({
                lastCompletedSprint: sprint.sprintNumber,
                totalSprints: spec.sprintPlan.length,
                passedSprints: sprintResults.filter(r => r.success).length,
                apiCalls: apiCallCount,
                costLog,
                timestamp: new Date().toISOString(),
              }, null, 2));
            } catch { /* state save is best-effort */ }
            // Clean state: 验证项目可交付 (Anthropic Article 1.5)
            const { execCommand } = await import("../utils/agent-executor.js");
            try { const tr = await execCommand("npm", ["test", "--", "--passWithNoTests"], { cwd: ctx.projectDir, timeout: 30000 }); console.log(`  🧹 ${tr.success ? "✅" : "⚠️"} 项目状态检查`); } catch { console.log("  🧹 ⚠️ 项目尚无测试"); }
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

          updateProgressSprint(ctx.projectDir, sprint.sprintNumber, { status: "failed", iterations: sprintIterations, notes: "stopped" });
        if (!sprintPassed) break; // 当前 Sprint 熔断，停止后续
      }

      ctx.sprintResults = sprintResults;
      const passed = sprintResults.filter(r => r.success).length;
      
      // API 成本汇总
      console.log(`\n💰 API 调用总计: ${apiCallCount} 次`);
      console.log(`   Sprint通过: ${passed}/${spec.sprintPlan.length}`);
      
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
  const checkpoints = process.env.HARNESS_CONFIRM === 'true';
  
  const middlewares: Middleware[] = [
    createPhase0Middleware(engine),
  ];
  
  if (checkpoints) middlewares.push(createCheckpointMiddleware('Phase0', '收敛需求已生成，请审查'));
  middlewares.push(createPlannerMiddleware(engine));
  
  if (checkpoints) middlewares.push(createCheckpointMiddleware('Phase1', 'Sprint计划已生成，请审查'));
  middlewares.push(createInitMiddleware(engine));
  middlewares.push(createGeneratorEvaluatorMiddleware(engine, 50, 10));
  
  if (checkpoints) middlewares.push(createCheckpointMiddleware('Phase2', '所有Sprint已完成，请审查'));
  middlewares.push(createDeliveryMiddleware(engine));
  middlewares.push(createDevOpsMiddleware(engine));
  middlewares.push(createMarketingMiddleware(engine));
  middlewares.push(createConvergenceMiddleware(5));
  
  return middlewares;
}

// ============= 确认断点中间件 =============

function createCheckpointMiddleware(label: string, msg: string): Middleware {
  return {
    name: 'Checkpoint-' + label,
    phase: 'checkpoint',
    agentDef: {
      id: 'agent-checkpoint-' + label.toLowerCase(),
      name: 'Checkpoint ' + label,
      role: 'gate',
      domain: 'orchestration',
      capabilities: ['pause', 'confirm'],
      engine: 'minimax',
    },
    async run(ctx: PipelineContext, next: () => Promise<void>) {
      console.log('\n' + '='.repeat(60));
      console.log('⏸️  CHECKPOINT: ' + label + ' | ' + msg);
      console.log('='.repeat(60));

      if (label === 'Phase0' && ctx.convergedRequirement) {
        console.log('收敛需求: ' + ctx.convergedRequirement.slice(0, 200) + '...');
      }
      if (label === 'Phase1' && ctx.productSpec) {
        const s = ctx.productSpec as any;
        console.log('Sprint: ' + (s.sprintPlan?.length || 0) + '个 | Must: ' + (s.featureList?.must?.length || 0) + '个');
      }
      if (label === 'Phase2' && ctx.sprintResults) {
        const sr = ctx.sprintResults as any[];
        console.log('通过: ' + sr.filter((r:any)=>r.success).length + '/' + sr.length);
      }

      console.log('\n[Enter=继续 | stop=终止 | retry=重试] (30s自动继续)');

      try {
        const rl = (await import('readline')).createInterface({ input: process.stdin, output: process.stdout });
        const input = await new Promise<string>(resolve => {
          const t = setTimeout(() => { rl.close(); resolve(''); }, 30000);
          rl.question('> ', (a: string) => { clearTimeout(t); rl.close(); resolve(a.trim().toLowerCase()); });
        });

        if (input === 'stop') {
          ctx.shouldStop = true;
          ctx.errors.push('用户手动停止于: ' + label);
          console.log('⏹️  用户终止');
          return;
        }
        if (input === 'retry') {
          console.log('🔄 用户要求重试 ' + label);
          ctx.shouldStop = false;
          if (label === 'Phase0') (ctx as any).convergedRequirement = undefined;
          if (label === 'Phase1') (ctx as any).productSpec = undefined;
          if (label === 'Phase2') (ctx as any).sprintResults = undefined;
          return;
        }
      } catch { /* stdin not available, auto-continue */ }

      console.log('✅ 继续执行');
      await next();
    },
  };
}
