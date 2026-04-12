/**
 * Harness Scheduler - 主调度器
 *
 * 实现 Phase 0→1→2→3→0 的完全自动化闭环循环
 */

import { spawn } from 'child_process';
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
          await executePhase2(state, config.projectDir, history);
          break;

        case 'phase3':
          await executePhase3(state, config.projectDir);
          break;
      }

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
    const output = await execClaudeCode([
      '--print',
      prompt
    ], 180000); // 3 分钟超时

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
  console.log('[Phase 1] 规划阶段开始...');

  // 基于 Phase 0 结果生成产品规格
  const spec = await generateProductSpec(
    state.phase0Output?.debateResult?.convergedRequirement || state.originalRequirement,
    projectDir
  );

  // 防御性检查：确保 sprintPlan 有内容
  if (!spec.sprintPlan || spec.sprintPlan.length === 0) {
    console.warn('[Phase 1] 警告: sprintPlan 为空，使用默认 Sprint');
    spec.sprintPlan = [{
      sprintNumber: 1,
      objectives: ['实现基础功能'],
      acceptanceCriteria: ['功能可运行'],
      estimatedDuration: '1-2小时',
      technicalConstraints: []
    }];
  }

  state.phase1Output = { spec };

  console.log('[Phase 1] 完成');
  console.log(`Sprint 数量: ${spec.sprintPlan.length}`);
}

/**
 * 生成产品规格
 */
async function generateProductSpec(
  convergedRequirement: string,
  projectDir: string
): Promise<ProductSpec> {
  const planningPrompt = `
# 产品规划任务

基于以下收敛后的需求，生成完整的产品规格文档：

${convergedRequirement}

## 你的任务
1. 生成产品概述
2. 划分功能列表（MUST/SHOULD/COULD）
3. 划分 Sprint（每个 Sprint 应该是独立的可交付单元）
4. 确定技术方向
5. 定义验收标准

## 输出格式（JSON）
{
  "overview": "产品概述",
  "featureList": {
    "must": ["必须有的功能"],
    "should": ["应该有的功能"],
    "could": ["可以有的功能"]
  },
  "sprintPlan": [
    {
      "sprintNumber": 1,
      "objectives": ["目标"],
      "acceptanceCriteria": ["验收标准"],
      "estimatedDuration": "预估时间",
      "technicalConstraints": ["技术约束"]
    }
  ],
  "technicalDirection": "技术方向描述",
  "acceptanceStandards": ["验收标准"]
}
`;

  try {
    const output = await execClaudeCode([
      '--print',
      planningPrompt
    ], 180000); // 3 分钟超时

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
                try {
                  return JSON.parse(result);
                } catch {
                  return createDefaultSpec(convergedRequirement);
                }
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
        return createDefaultSpec(convergedRequirement);
      }
    }
  } catch (error) {
    console.error('[Phase 1] 规格生成失败:', error);
    return createDefaultSpec(convergedRequirement);
  }
}

/**
 * 创建默认规格
 */
function createDefaultSpec(requirement: string): ProductSpec {
  return {
    overview: requirement,
    featureList: {
      must: ['基础功能实现'],
      should: ['核心功能完善'],
      could: ['高级功能']
    },
    sprintPlan: [
      {
        sprintNumber: 1,
        objectives: ['实现基础功能'],
        acceptanceCriteria: ['功能可运行', '无明显bug'],
        estimatedDuration: '1-2小时',
        technicalConstraints: []
      }
    ],
    technicalDirection: '待确定',
    acceptanceStandards: ['可运行', '功能完整']
  };
}

// ============= Phase 2: 开发 =============

async function executePhase2(
  state: HarnessState,
  projectDir: string,
  history: IterationSnapshot[]
): Promise<void> {
  console.log('[Phase 2] 开发阶段开始...');

  if (!state.phase1Output?.spec) {
    throw new Error('Phase 1 输出不存在');
  }

  // 执行 Sprint 计划
  const sprintResults = await executeSprintPlan(
    projectDir,
    state.phase1Output.spec
  );

  // 记录历史
  const latestSnapshot = createSnapshot(
    state.iterationCount,
    sprintResults[sprintResults.length - 1] || createDefaultReport(),
    history.length > 0 ? hasValueImprovement(
      sprintResults[sprintResults.length - 1] ? createSnapshot(state.iterationCount, sprintResults[sprintResults.length - 1], true) : null,
      history[history.length - 1] || null
    ) : true
  );

  history.push(latestSnapshot);

  state.phase2Output = {
    currentSprint: state.phase1Output.spec?.sprintPlan?.length ?? 0,
    sprintResults
  };

  // 打印摘要
  const prevSnapshot = history.length > 1 ? history[history.length - 2] : null;
  console.log(`\n${generateIterationSummary(state.iterationCount, latestSnapshot, prevSnapshot, state.convergenceStatus)}`);

  console.log('[Phase 2] 完成');
}

/**
 * 创建默认报告
 */
function createDefaultReport(): SupervisorReport {
  return {
    verdict: 'REJECTED',
    totalScore: 5,
    dimensionScores: {
      productDepth: 5,
      userExperience: 5,
      codeQuality: 5,
      security: 5
    },
    issues: ['无报告']
  };
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

  const config: HarnessConfig = {
    requirement,
    projectDir,
    maxIterations,
    model: 'sonnet',
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
async function execClaudeCode(args: string[], timeout: number = 300000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
