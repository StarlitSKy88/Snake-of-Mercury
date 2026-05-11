/**
 * Harness Scheduler - 主调度器
 *
 * 实现 Phase 0→1→2→3→0 的完全自动化闭环循环
 */

import { executeAgent, detectAvailableEngines, type AgentEngine } from "./utils/agent-executor.js";
import { EventBus } from "./event-bus.js";
import { RalphWiggumLoop } from "./ralph-loop.js";
import { CEOAgent } from "./ceo-agent.js";
import { DevOpsAgent } from "./devops-agent.js";
import { MarketingAgent } from "./marketing-agent.js";
import { existsSync } from 'fs';
import { join } from 'path';

import type {
  HarnessConfig,
  HarnessState,
  ProductSpec,
  SprintContract,
  SupervisorReport,
  IterationSnapshot,
  DebateResult
} from './types.js';

import {
  createInitialState,
  loadState,
  saveState,
  getNextPhase,
  getPhaseLabel,
  formatStateSummary
} from './state-machine.js';

import {
  executeHubDebate
} from './integrations/debate-engine-hub.js';

import { executePlanner } from './planner-agent.js';
import { executeGenerator, negotiateSprintContract } from './generator-agent.js';
import { executeEvaluator, reviewSprintContract } from './evaluator-agent.js';

import {
  executeSprintPlan
} from './developer-supervisor.js';

import {
  detectConvergence,
  createSnapshot,
  hasValueImprovement,
  generateIterationSummary,
  getNextActionAdvice,
  generateAutonomousExplorationTasks,
  decideNextDirection
} from './convergence-detector.js';

import {
  executePhase3Delivery
} from './phase3-delivery.js';

// ============= 常量 =============

const DEFAULT_MAX_ITERATIONS = 50;
const STATE_FILE = '.harness-state.json';
const PHASE0_PROBLEM_TEMPLATE = `
# 用户原始需求
{requirement}

请基于以上需求，生成一个标准化的 8 模块问题定义：
1. Context snapshot（上下文快照）
2. Problem statement（问题陈述 + why now）
3. JTBD（用户待办任务 + 目标人群）
4. Current alternatives + gaps（替代方案 + 缺口）
5. Evidence & assumptions log（证据 + 假设日志）
6. Success criteria + guardrails（成功标准 + 护栏）
7. Scope boundaries（范围边界 in/out）
8. Prototype / learning plan（原型验证计划）

请以 JSON 格式输出。
`;

// ============= 主循环 =============

/**
 * 执行 Harness 主循环
 */
export async function runHarnessLoop(config: HarnessConfig): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║         Snake of Mercury - Unified Autopilot 启动              ║
╠════════════════════════════════════════════════════════════════╣
║  项目: ${config.projectDir.padEnd(51)}║
║  需求: ${(config.requirement.substring(0, 50) + (config.requirement.length > 50 ? '...' : '')).padEnd(51)}║
║  最大迭代: ${String(config.maxIterations || DEFAULT_MAX_ITERATIONS).padEnd(48)}║
╚════════════════════════════════════════════════════════════════╝
  `);

  const stateFilePath = join(config.projectDir, STATE_FILE);

  // 初始化 EventBus（Agent间通信中枢）
  const eventBus = new EventBus(join(config.projectDir, '.events'));

  // 初始化 CEO Agent（订阅关键事件）
  const ceo = new CEOAgent(config.projectDir, config.engine || 'claude', process.env.WEBHOOK_URL);
  
  // CEO 通过 EventBus 接收其他 Agent 的消息
  eventBus.onMany(
    ['sprint:passed', 'sprint:rejected', 'sprint:rollback', 'devops:escalated', 'marketing:optimization_task', 'system:error'],
    (event) => {
      const type = event.type.includes('passed') ? 'progress' :
                   event.type.includes('rejected') ? 'error' :
                   event.type.includes('escalated') ? 'error' : 'progress';
      ceo.notify(
        event.projectId || '',
        type as 'progress' | 'error',
        `[${event.source}] ${event.type}: ${JSON.stringify(event.payload).slice(0, 100)}`
      );
    }
  );
  const existingProject = ceo.listProjects().find(p => p.name === config.requirement.slice(0, 30));

  let projectId: string;
  if (existingProject) {
    projectId = existingProject.id;
    ceo.notify(projectId, 'progress', '🔄 恢复项目执行');
  } else {
    const project = ceo.createProject(
      config.requirement.slice(0, 50),
      config.requirement
    );
    projectId = project.id;
  }

  // 初始化 DevOps Agent
  const devops = new DevOpsAgent(
    config.projectDir,
    config.engine || 'claude',
    (incident) => ceo.notify(projectId, 'error', `🚨 ${incident.description}`)
  );

  // 初始化 Marketing Agent
  const marketing = new MarketingAgent(
    config.projectDir,
    config.engine || 'claude',
    (task) => ceo.notify(projectId, 'progress', `📈 优化任务: ${task.title}`)
  );

  // 加载或创建状态
  let state = loadState(stateFilePath);
  if (!state) {
    state = createInitialState(config);
  } else {
    console.log(`[恢复] 从上次中断处继续，迭代 ${state.iterationCount}\n`);
  }

  const maxIterations = config.maxIterations || DEFAULT_MAX_ITERATIONS;
  let autonomousExplorationCount = 0;
  let history: IterationSnapshot[] = [];

  // 主循环
  while (state.iterationCount <= maxIterations && !state.convergenceStatus.shouldStop) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`迭代 ${state.iterationCount} / ${maxIterations}`);
    console.log(`当前阶段: ${getPhaseLabel(state.currentPhase)}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // 根据当前阶段执行
      switch (state.currentPhase) {
        case 'phase0':
          await executePhase0(state, config.projectDir);
          break;

        case 'phase1':
          await executePhase1(state, config.projectDir);
          break;

        case 'phase2':
          await executePhase2(state, config.projectDir, history, projectId, eventBus, ceo);
          break;

        case 'phase3':
          await executePhase3(state, config.projectDir);
          break;
      }

      // 同步 CEO Agent
      ceo.updateProject(projectId, {
        currentPhase: state.currentPhase,
        currentSprint: state.phase2Output?.currentSprint || 0,
        totalSprints: state.phase1Output?.spec?.sprintPlan?.length || 0,
        passedSprints: state.phase2Output?.sprintResults?.filter(r => r.verdict === 'APPROVED').length || 0,
      });

      // 状态转换
      state.currentPhase = getNextPhase(state.currentPhase);

      // Phase 3 完成后检测收敛
      if (state.currentPhase === 'phase0') {
        // 保存迭代历史
        saveState(stateFilePath, state);

        // 检测收敛
        const convergenceStatus = detectConvergence(
          history,
          '', // 无用户消息
          autonomousExplorationCount
        );

        state.convergenceStatus = convergenceStatus;

        if (convergenceStatus.signal === 'STOP') {
          console.log(`\n🔴 收敛停止: ${convergenceStatus.reason}`);
          ceo.updateProject(projectId, { status: 'deployed' });
          ceo.notify(projectId, 'completed', `🎉 项目完成! ${state.phase2Output?.sprintResults?.filter(r=>r.verdict==='APPROVED').length || 0}/${state.phase1Output?.spec?.sprintPlan?.length || 0} Sprint通过`);
          
          // 打印最终摘要
          ceo.printAllSummaries();
          if (devops) console.log(devops.getSummary());
          if (marketing) console.log(marketing.getSummary());
          break;
        }

        if (convergenceStatus.signal === 'EXPLORE') {
          autonomousExplorationCount++;
          console.log(`\n🟡 进入自主挖掘模式 (${autonomousExplorationCount}/${2})`);

          // 生成探索任务
          const latestSnapshot = history[history.length - 1];
          if (latestSnapshot) {
            const tasks = generateAutonomousExplorationTasks(
              latestSnapshot,
              state.originalRequirement
            );
            console.log(`探索方向: ${decideNextDirection(history, tasks)}`);
          }
        }

        // 进入下一迭代（ROLLBACK 或 CONTINUE 的情况）
        state.iterationCount++;
        console.log(`\n🟢 进入迭代 ${state.iterationCount}...\n`);
      }

      // 保存状态
      saveState(stateFilePath, state);

    } catch (error) {
      console.error(`\n❌ 迭代 ${state.iterationCount} 执行失败:`, error);
      state.convergenceStatus = {
        signal: 'CONTINUE',
        reason: `错误: ${error instanceof Error ? error.message : String(error)}`,
        consecutiveNoImprovement: 0,
        qualityTrend: 'stable',
        shouldStop: false
      };
      saveState(stateFilePath, state);
    }
  }

  // 结束
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    运行完成                                     ║
╠════════════════════════════════════════════════════════════════╣
║  总迭代次数: ${state.iterationCount}                                            ║
║  最终阶段: ${getPhaseLabel(state.currentPhase).padEnd(47)}║
║  收敛原因: ${(state.convergenceStatus.reason || 'N/A').substring(0, 47).padEnd(47)}║
╚════════════════════════════════════════════════════════════════╝
  `);
}

// ============= Phase 0: 产品创新 =============

async function executePhase0(state: HarnessState, projectDir: string): Promise<void> {
  console.log('[Phase 0] 产品创新阶段开始...');

  // 生成问题定义
  const problemDefinition = await generateProblemDefinition(
    state.originalRequirement,
    projectDir
  );

  // 执行辩论（优先使用 Hub 模式，失败则 fallback 到文件模式）
  console.log('[Phase 0] 启动辩论引擎...');
  const debateResult = await executeHubDebate(
    projectDir,
    problemDefinition,
    state.iterationCount,
    {
      useFileFallback: true, // 允许 fallback 到文件模式
      hubConfig: {
        logLevel: 'info',
        agentTimeout: 120000,
        maxAgents: 10
      }
    }
  );

  // 保存结果
  state.phase0Output = {
    problemDefinition,
    debateResult
  };

  console.log('[Phase 0] 完成');
  console.log(`收敛需求: ${debateResult.convergedRequirement.substring(0, 100)}...`);
}

/**
 * 生成问题定义
 */
async function generateProblemDefinition(
  requirement: string,
  projectDir: string
): Promise<any> {
  const prompt = PHASE0_PROBLEM_TEMPLATE.replace('{requirement}', requirement);

  try {
    const output = await execAgent(prompt, 180000); // 3 分钟超时

    // 尝试解析 JSON 输出
    try {
      const parsed = JSON.parse(output.trim());
      // 如果解析成功且有 content 字段，提取它
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) {
          // 找到最后一个有 result 字段的消息
          for (let i = parsed.length - 1; i >= 0; i--) {
            if (parsed[i].result) {
              const result = parsed[i].result;
              if (typeof result === 'string') {
                return JSON.parse(result);
              }
              return result;
            }
          }
        }
        return parsed.content || parsed;
      }
      return parsed;
    } catch {
      // JSON 解析失败，尝试直接返回输出
      const content = output.trim();
      try {
        return JSON.parse(content);
      } catch {
        // 也不是 JSON，返回默认结构
        return {
          contextSnapshot: requirement,
          problemStatement: requirement,
          jtbd: '待定义',
          currentAlternatives: '待分析',
          evidenceAndAssumptions: [],
          successCriteria: ['功能完整', '可正常运行'],
          scopeBoundaries: { inScope: [], outOfScope: [] },
          prototypePlan: '待规划'
        };
      }
    }
  } catch (error) {
    console.error('[Phase 0] 问题定义生成失败:', error);
    return {
      contextSnapshot: requirement,
      problemStatement: requirement,
      jtbd: '待定义',
      currentAlternatives: '待分析',
      evidenceAndAssumptions: [],
      successCriteria: ['功能完整', '可正常运行'],
      scopeBoundaries: { inScope: [], outOfScope: [] },
      prototypePlan: '待规划'
    };
  }
}

// ============= Phase 1: 规划 =============

async function executePhase1(state: HarnessState, projectDir: string): Promise<void> {
  console.log('[Phase 1] Planner Agent 启动...');

  const engine = (process.env.HARNESS_ENGINE || 'claude') as AgentEngine;

  // 使用 Anthropic 官方 Planner Agent
  const plannerResult = await executePlanner(
    {
      originalRequirement: state.originalRequirement,
      debateResult: state.phase0Output?.debateResult,
      projectDir,
    },
    engine
  );

  const spec = plannerResult.spec;

  // 防御性检查
  if (!spec.sprintPlan || spec.sprintPlan.length === 0) {
    console.warn('[Phase 1] sprintPlan 为空，使用默认 Sprint');
    spec.sprintPlan = [{
      sprintNumber: 1,
      objectives: ['实现基础功能'],
      acceptanceCriteria: ['功能可运行'],
      estimatedDuration: '1-2小时',
      technicalConstraints: []
    }];
  }

  state.phase1Output = { spec };

  console.log(`[Phase 1] Planner 完成: ${spec.featureList.must.length} 必须功能, ${spec.sprintPlan.length} Sprint`);
}


// ============= Phase 2: 开发 =============

async function executePhase2(
  state: HarnessState,
  projectDir: string,
  history: IterationSnapshot[],
  projectId: string,
  eventBus: EventBus,
  ceo: CEOAgent
): Promise<void> {
  console.log('[Phase 2] Generator + Evaluator 闭环启动...');

  if (!state.phase1Output?.spec) {
    throw new Error('Phase 1 输出不存在');
  }

  const engine = (process.env.HARNESS_ENGINE || 'claude') as AgentEngine;
  const spec = state.phase1Output.spec;
  const sprintResults: SupervisorReport[] = [];
  const MAX_SPRINT_RETRIES = 3;

  // 初始化 Ralph Wiggum Loop（任务级循环）
  // 检测模型是否需要 context reset（DeepSeek 等非 Opus 模型建议开启）
  const needsContextReset = engine === 'codex' ||
    (process.env.HARNESS_MODEL || '').toLowerCase().includes('deepseek') ||
    process.env.CONTEXT_RESET === 'true';

  const ralphLoop = new RalphWiggumLoop({
    mode: process.env.RALPH_MODE === 'ralphy' ? 'ralphy' : 'internal',
    engine,
    projectDir,
    projectId,
    maxIterations: 50,
    maxRetriesPerTask: 3,
    eventBus,
    contextReset: needsContextReset,
    contextResetInterval: 1, // 每个任务后重置
  });

  if (needsContextReset) {
    console.log('[Ralph Loop] 🧹 Context Reset 已启用 (DeepSeek适配)');
  }

  ralphLoop.initTasks(spec.sprintPlan);

  // 定义任务执行函数
  const ralphResult = await ralphLoop.run(
    async (sprint, retry, lastError) => {
      // Ralph Loop 的每次迭代：Sprint Contract → Generator → Evaluator
      const proposedContract = await negotiateSprintContract(sprint, spec, engine);
      const contractReview = await reviewSprintContract(sprint, proposedContract, engine);

      eventBus.emit('sprint:contract_proposed', 'generator', {
        sprintNumber: sprint.sprintNumber,
        approved: contractReview.approved,
        projectId,
      });

      const genResult = await executeGenerator(
        { sprint, spec, projectDir, previousIssues: lastError ? [lastError] : [], sprintContract: proposedContract },
        engine
      );

      if (!genResult.success) {
        eventBus.emit('sprint:rejected', 'generator', { sprintNumber: sprint.sprintNumber, error: 'Generator失败', projectId });
        return { passed: false, error: 'Generator 执行失败' };
      }

      eventBus.emit('sprint:generator_done', 'generator', { sprintNumber: sprint.sprintNumber, projectId });

      const report = await executeEvaluator(
        { sprint, spec, generatorOutput: genResult.output, projectDir, sprintContract: proposedContract },
        engine
      );

      eventBus.emit('sprint:evaluator_done', 'evaluator', {
        sprintNumber: sprint.sprintNumber,
        verdict: report.verdict,
        score: report.totalScore,
        projectId,
      });

      sprintResults.push(report);

      if (report.verdict === 'APPROVED') {
        return { passed: true, report };
      } else if (report.verdict === 'ROLLBACK') {
        eventBus.emit('sprint:rollback', 'evaluator', { sprintNumber: sprint.sprintNumber, projectId });
        return { passed: false, error: 'Evaluator ROLLBACK' };
      } else {
        return { passed: false, error: report.issues.join('; '), report };
      }
    },
    (sprintNumber) => spec.sprintPlan.find(s => s.sprintNumber === sprintNumber)
  );

  ceo.updateProject(projectId, {
    passedSprints: ralphResult.passed,
    totalSprints: ralphResult.total,
  });


  // 记录历史
  const lastReport = sprintResults[sprintResults.length - 1];
  if (lastReport) {
    const latestSnapshot = createSnapshot(
      state.iterationCount,
      lastReport,
      history.length > 0
        ? hasValueImprovement(
            createSnapshot(state.iterationCount, lastReport, true),
            history[history.length - 1] || null
          )
        : true
    );
    history.push(latestSnapshot);

    const prevSnapshot = history.length > 1 ? history[history.length - 2] : null;
    console.log(`\n${generateIterationSummary(state.iterationCount, latestSnapshot, prevSnapshot, state.convergenceStatus)}`);
  }

  state.phase2Output = {
    currentSprint: spec.sprintPlan.length,
    sprintResults,
  };

  console.log(`[Phase 2] 完成: ${sprintResults.filter(r => r.verdict === 'APPROVED').length}/${spec.sprintPlan.length} Sprint 通过`);
}



// ============= Phase 3: 交付 =============

async function executePhase3(state: HarnessState, projectDir: string): Promise<void> {
  console.log('[Phase 3] 交付阶段开始...');

  // 执行完整交付流程
  const deliveryResult = await executePhase3Delivery(state, projectDir);

  // 更新状态
  state.phase3Output = {
    deployed: deliveryResult.deployment.success,
    canaryResult: deliveryResult.canary || undefined
  };

  console.log('[Phase 3] 完成');
}

// ============= CLI 入口 =============

/**
 * 主入口
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Snake of Mercury - Unified Autopilot

用法:
  npm run harness -- "你的产品需求"
  npm run harness -- "build a blog with comments"

选项:
  --project <dir>    指定项目目录 (默认: 当前目录)
  --max-iterations   最大迭代次数 (默认: 50)
  --model <model>    使用的模型 (默认: sonnet)
    `);
    process.exit(1);
  }

  // 解析参数
  const requirement = args[0];
  const projectDir = process.cwd();
  const maxIterations = 50;

  const engine = (process.env.HARNESS_ENGINE || "claude") as AgentEngine;
  const model = process.env.HARNESS_MODEL || "sonnet";
  
  console.log(`引擎: ${engine} | 模型: ${model}`);
  
  const config: HarnessConfig = {
    requirement,
    projectDir,
    maxIterations,
    model, engine,
    autoDeploy: true
  };

  try {
    await runHarnessLoop(config);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// 执行
main().catch(console.error);

// ============= 工具函数 =============

/**
 * 执行 Claude Code CLI 命令
 * 注意：CLI 操作可能较慢，默认超时设置为 5 分钟
 */
/**
 * 执行 Agent 命令（引擎无关）
 * 通过 executeAgent 自动选择 Claude SDK / Claude CLI / Codex CLI
 */
async function execAgent(prompt: string, timeout: number = 300000): Promise<string> {
  // 引擎和模型从环境变量读取
  const engine = (process.env.HARNESS_ENGINE || 'claude') as AgentEngine;
  
  const result = await executeAgent(
    'You are a skilled software engineer working on the Snake-of-Mercury harness system.',
    prompt,
    {
      engine,
      model: process.env.HARNESS_MODEL,
      workdir: process.cwd(),
      timeout,
    }
  );

  if (!result.success) {
    throw new Error(`Agent execution failed (${engine}): ${result.error || 'Unknown error'}`);
  }

  return result.output;
}

// 这行已在上方更新
