/**
 * Hub Debate Engine - 基于 Hub 的辩论引擎
 *
 * 使用 Hub 架构实现多 Agent 实时通信辩论，
 * 同时保持与原有文件共享模式的兼容性
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

import { Hub } from '../hub/index.js';
import { createHub } from '../hub/index.js';
import { ProcessAgent } from '../agent/process-agent.js';

import type {
  AgentOutput,
  DebateResult,
  ProblemDefinition
} from '../types.js';

import {
  METHODS,
  createNotification
} from '../protocols/messages.js';

// ============= 常量 =============

const DEBATE_DIR = '.phase0-debate';
const ROUND_TIMEOUT = 120000;

/**
 * 辩论 Agent 列表
 */
const DEBATE_AGENTS = [
  'phase0-insight-challenger',
  'phase0-innovation-officer',
  'phase0-business-operator',
  'architect',
  'planner'
] as const;

/**
 * Agent 显示名称
 */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'phase0-insight-challenger': '需求重构洞察者',
  'phase0-innovation-officer': '颠覆式创新官',
  'phase0-business-operator': '商业闭环操盘手',
  'architect': '工程落地官',
  'planner': '规划收敛者'
};

// ============= 类型 =============

/**
 * Hub 辩论引擎选项
 */
export interface HubDebateOptions {
  /** 项目目录 */
  projectDir: string;
  /** 迭代 ID */
  iterationId: number;
  /** 是否使用文件 fallback */
  useFileFallback?: boolean;
  /** Hub 配置 */
  hubConfig?: {
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    agentTimeout?: number;
    maxAgents?: number;
  };
}

/**
 * 辩论状态
 */
interface DebateState {
  phase: 'round1' | 'round2' | 'round3' | 'synthesis';
  outputs: Map<string, string>;
  challenges: Map<string, string>;
  responses: Map<string, string>;
}

// ============= HubDebateEngine =============

/**
 * Hub 辩论引擎
 */
export class HubDebateEngine extends EventEmitter {
  private hub: Hub | null = null;
  private agents: Map<string, ProcessAgent> = new Map();
  private options: HubDebateOptions;
  private state: DebateState;
  private useHub: boolean = true;

  constructor(options: HubDebateOptions) {
    super();
    this.options = options;
    this.state = {
      phase: 'round1',
      outputs: new Map(),
      challenges: new Map(),
      responses: new Map()
    };
  }

  /**
   * 初始化 Hub
   */
  async initialize(): Promise<void> {
    if (this.options.useFileFallback) {
      this.useHub = false;
      return;
    }

    try {
      this.hub = createHub({
        logLevel: this.options.hubConfig?.logLevel || 'info',
        agentTimeout: this.options.hubConfig?.agentTimeout || 120000,
        maxAgents: this.options.hubConfig?.maxAgents || 10,
        strictMode: false
      });

      await this.hub.start();
      this.emit('hub:started');
    } catch (error) {
      console.warn('[HubDebateEngine] Failed to start Hub, falling back to file mode:', error);
      this.useHub = false;
    }
  }

  /**
   * 执行辩论
   */
  async executeDebate(problemDefinition: ProblemDefinition): Promise<DebateResult> {
    if (!this.useHub || !this.hub) {
      return this.executeFileBasedDebate(problemDefinition);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Phase 0: Hub 辩论 (迭代 ${this.options.iterationId})`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // 启动辩论 Agent
      await this.spawnDebateAgents();

      // Round 1: 发送问题定义给所有 Agent
      console.log('[Hub Debate] Round 1: 发送问题定义...');
      await this.executeRound1(problemDefinition);

      // Round 2: 收集所有 Agent 的洞察
      console.log('[Hub Debate] Round 2: 收集洞察...');
      const round1Outputs = await this.collectRound1Outputs();

      // Round 3: 发送其他 Agent 的洞察给每个 Agent（用于互相质疑）
      console.log('[Hub Debate] Round 3: 互相质疑...');
      await this.executeRound2(round1Outputs);

      // Round 4: 收集质疑
      const challenges = await this.collectRound2Challenges();

      // Round 5: 回应质疑
      console.log('[Hub Debate] Round 4: 回应质疑...');
      await this.executeRound3(challenges);

      // Round 6: 收集回应
      const responses = await this.collectRound3Responses();

      // Synthesis: Planner 整合
      console.log('[Hub Debate] Synthesis: 整合收敛...');
      const result = await this.executeSynthesis(round1Outputs, challenges, responses);

      return result;

    } finally {
      await this.cleanup();
    }
  }

  /**
   * Spawn 所有辩论 Agent
   */
  private async spawnDebateAgents(): Promise<void> {
    console.log('[Hub] Spawning debate agents...');

    for (const agentType of DEBATE_AGENTS) {
      await this.spawnAgent(agentType);
    }

    console.log(`[Hub] ${this.agents.size} agents spawned`);
  }

  /**
   * Spawn 单个 Agent
   */
  private async spawnAgent(agentType: string): Promise<void> {
    const displayName = AGENT_DISPLAY_NAMES[agentType];
    console.log(`[Hub] Spawning ${displayName}...`);

    const agent = new ProcessAgent({
      name: agentType,
      type: 'debate-agent',
      command: 'claude',
      args: ['--print'],
      timeout: ROUND_TIMEOUT
    }, {
      onMessage: (method, params) => {
        this.handleAgentMessage(agentType, method, params);
      },
      onError: (error) => {
        console.error(`[Hub] ${displayName} error:`, error);
      },
      onExit: (code) => {
        console.log(`[Hub] ${displayName} exited with code ${code}`);
      }
    });

    await agent.start();
    this.agents.set(agentType, agent);
  }

  /**
   * 处理 Agent 消息
   */
  private handleAgentMessage(agentType: string, method: string, params?: Record<string, unknown>): void {
    if (method === 'debate:output') {
      const output = params?.output as string;
      if (output) {
        this.state.outputs.set(agentType, output);
      }
    } else if (method === 'debate:challenges') {
      const challenges = params?.challenges as string;
      if (challenges) {
        this.state.challenges.set(agentType, challenges);
      }
    } else if (method === 'debate:responses') {
      const response = params?.responses as string;
      if (response) {
        this.state.responses.set(agentType, response);
      }
    }
  }

  /**
   * 执行 Round 1
   */
  private async executeRound1(problemDefinition: ProblemDefinition): Promise<void> {
    const prompt = this.buildInsightPrompt(problemDefinition);

    // 广播问题定义给所有 Agent
    for (const [agentType, agent] of this.agents) {
      agent.sendNotification('debate:start', {
        phase: 'round1',
        prompt,
        outputType: 'insight'
      });
    }

    // 等待所有 Agent 输出
    await this.waitForOutputs('round1', DEBATE_AGENTS.length);
  }

  /**
   * 收集 Round 1 输出
   */
  private async collectRound1Outputs(): Promise<AgentOutput[]> {
    const outputs: AgentOutput[] = [];

    for (const agentType of DEBATE_AGENTS) {
      const content = this.state.outputs.get(agentType) || '';
      outputs.push({ agentName: agentType, content });
    }

    return outputs;
  }

  /**
   * 执行 Round 2
   */
  private async executeRound2(round1Outputs: AgentOutput[]): Promise<void> {
    const othersOutput = round1Outputs
      .filter(o => o.agentName !== 'planner') // Planner 不参与质疑
      .map(o => `## ${AGENT_DISPLAY_NAMES[o.agentName]}\n${o.content}`)
      .join('\n\n');

    for (const [agentType, agent] of this.agents) {
      if (agentType === 'planner') continue;

      const myOutput = round1Outputs.find(o => o.agentName === agentType)?.content || '';

      agent.sendNotification('debate:start', {
        phase: 'round2',
        myOutput,
        othersOutput,
        outputType: 'challenges'
      });
    }

    // 等待所有 Agent 输出
    await this.waitForOutputs('round2', DEBATE_AGENTS.length - 1); // Planner 不参与
  }

  /**
   * 收集 Round 2 质疑
   */
  private async collectRound2Challenges(): Promise<Map<string, string>> {
    const challenges = new Map<string, string>();

    for (const agentType of DEBATE_AGENTS) {
      if (agentType === 'planner') continue;
      const content = this.state.challenges.get(agentType) || '';
      challenges.set(agentType, content);
    }

    return challenges;
  }

  /**
   * 执行 Round 3
   */
  private async executeRound3(challenges: Map<string, string>): Promise<void> {
    for (const [agentType, agent] of this.agents) {
      const myChallenges = challenges.get(agentType) || '';
      const myOutput = this.state.outputs.get(agentType) || '';

      agent.sendNotification('debate:start', {
        phase: 'round3',
        myOutput,
        myChallenges,
        outputType: 'responses'
      });
    }

    // 等待所有 Agent 输出
    await this.waitForOutputs('round3', DEBATE_AGENTS.length);
  }

  /**
   * 收集 Round 3 回应
   */
  private async collectRound3Responses(): Promise<Map<string, string>> {
    return this.state.responses;
  }

  /**
   * 执行整合
   */
  private async executeSynthesis(
    round1Outputs: AgentOutput[],
    challenges: Map<string, string>,
    responses: Map<string, string>
  ): Promise<DebateResult> {
    // 构建辩论摘要
    const debateSummary = round1Outputs.map(agent => {
      const c = challenges.get(agent.agentName) || '';
      const r = responses.get(agent.agentName) || '';
      return `## ${AGENT_DISPLAY_NAMES[agent.agentName]}
### 原始洞察
${agent.content}

### 质疑
${c}

### 回应
${r}
`;
    }).join('\n\n---\n\n');

    // 发送给 Planner 进行整合
    const plannerAgent = this.agents.get('planner');
    if (!plannerAgent) {
      throw new Error('Planner agent not found');
    }

    const synthesisPrompt = this.buildSynthesisPrompt(debateSummary);

    // 发送合成请求
    plannerAgent.sendNotification('debate:synthesis', {
      summary: debateSummary,
      prompt: synthesisPrompt
    });

    // 等待 Planner 输出
    await this.waitForOutputs('synthesis', 1);

    const convergedRequirement = this.state.outputs.get('planner') || debateSummary;

    return {
      convergedRequirement,
      acceptanceCriteria: [],
      agentOutputs: round1Outputs,
      commonGround: [],
      keyDisagreements: [],
      finalDecisions: []
    };
  }

  /**
   * 等待输出
   */
  private async waitForOutputs(phase: string, expectedCount: number, timeout: number = ROUND_TIMEOUT): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 500;

      const check = () => {
        if (phase === 'round1') {
          let count = 0;
          for (const agentType of DEBATE_AGENTS) {
            if (this.state.outputs.has(agentType)) count++;
          }
          if (count >= expectedCount) {
            resolve();
            return true;
          }
        } else if (phase === 'round2') {
          let count = 0;
          for (const agentType of DEBATE_AGENTS) {
            if (agentType === 'planner') continue;
            if (this.state.challenges.has(agentType)) count++;
          }
          if (count >= expectedCount) {
            resolve();
            return true;
          }
        } else if (phase === 'round3' || phase === 'synthesis') {
          if (phase === 'synthesis' && this.state.outputs.has('planner')) {
            resolve();
            return true;
          }
          if (this.state.responses.size >= DEBATE_AGENTS.length) {
            resolve();
            return true;
          }
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for ${phase} outputs`));
          return true;
        }

        return false;
      };

      // 使用 setInterval 定期检查
      const timer = setInterval(() => {
        if (check()) {
          clearInterval(timer);
        }
      }, checkInterval);
    });
  }

  /**
   * 构建洞察 Prompt
   */
  private buildInsightPrompt(problem: ProblemDefinition): string {
    const baseContext = `
# 问题定义

## 上下文快照
${problem.contextSnapshot}

## 问题陈述
${problem.problemStatement}

## JTBD (Jobs to be Done)
${problem.jtbd}

## 当前替代方案
${problem.currentAlternatives}

## 成功标准
${problem.successCriteria.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## 范围边界
**In Scope:**
${problem.scopeBoundaries.inScope.map(s => `- ${s}`).join('\n')}

**Out of Scope:**
${problem.scopeBoundaries.outOfScope.map(s => `- ${s}`).join('\n')}
`;

    return baseContext;
  }

  /**
   * 构建合成 Prompt
   */
  private buildSynthesisPrompt(debateSummary: string): string {
    return `
你是**规划收敛者**，负责整合 5 个视角的辩论结果。

## 完整辩论摘要
${debateSummary}

## 你的任务
1. **识别共识点**：找出所有 Agent 都同意的点
2. **识别关键分歧**：找出观点不一致的地方
3. **做出最终裁决**：对每个分歧给出最终决定
4. **输出收敛需求**：综合所有观点的最终产品需求

格式：

### 共识点
- [共识 1]
- [共识 2]

### 关键分歧
1. [分歧描述]
   - 各方观点: [描述]
   - 最终裁决: [你的决定及理由]

### 收敛需求
[综合后的完整产品需求描述]

### 验收标准
1. [标准 1]
2. [标准 2]
3. [标准 3]
`;
  }

  /**
   * 执行基于文件的辩论（fallback）
   */
  private async executeFileBasedDebate(problemDefinition: ProblemDefinition): Promise<DebateResult> {
    console.log('[HubDebateEngine] Using file-based debate (fallback)');

    // 动态导入原有实现
    const { executePhase0Debate } = await import('../phase0-debate-engine.js');
    return executePhase0Debate(
      this.options.projectDir,
      problemDefinition,
      this.options.iterationId
    );
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    // 停止所有 Agent
    for (const [agentType, agent] of this.agents) {
      try {
        await agent.stop();
      } catch (error) {
        console.error(`[Hub] Error stopping ${agentType}:`, error);
      }
    }
    this.agents.clear();

    // 停止 Hub
    if (this.hub) {
      await this.hub.stop();
      this.hub = null;
    }
  }

  /**
   * 销毁引擎
   */
  async destroy(): Promise<void> {
    await this.cleanup();
  }
}

// ============= 便捷函数 =============

/**
 * 执行 Hub 辩论
 */
export async function executeHubDebate(
  projectDir: string,
  problemDefinition: ProblemDefinition,
  iterationId: number,
  options?: {
    useFileFallback?: boolean;
    hubConfig?: {
      logLevel?: 'debug' | 'info' | 'warn' | 'error';
      agentTimeout?: number;
      maxAgents?: number;
    };
  }
): Promise<DebateResult> {
  const engine = new HubDebateEngine({
    projectDir,
    iterationId,
    useFileFallback: options?.useFileFallback,
    hubConfig: options?.hubConfig
  });

  await engine.initialize();
  return engine.executeDebate(problemDefinition);
}
