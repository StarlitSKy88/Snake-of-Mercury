/**
 * Ralph Wiggum Loop — 任务级自主开发循环
 * 
 * 设计原则（对齐用户期望）：
 * - 任务粒度：每个Sprint一个独立循环
 * - 上下文管理：每个Agent调用获得干净上下文（基于Anthropic最新发现，强模型无需强制reset）
 * - 验证→修复→重验证闭环
 * - 熔断：单任务最多3次重试，总迭代上限50次
 * - 进度持久化：断点续跑
 * 
 * 集成方式：
 * - 内部模式：调用 Generator→Evaluator Agent
 * - 外部模式：调用 Ralphy CLI（ralphy --codex）
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execCommand, type AgentEngine } from './utils/agent-executor.js';
import { EventBus, type BusEvent } from './event-bus.js';
import type { SprintContract, SupervisorReport } from './types.js';

// ============= 类型 =============

export type LoopMode = 'internal' | 'ralphy';

export interface RalphLoopConfig {
  mode: LoopMode;
  engine: AgentEngine;
  projectDir: string;
  projectId?: string;
  maxIterations: number;
  maxRetriesPerTask: number;
  eventBus?: EventBus;
  /** 每次任务前重置上下文（DeepSeek等模型建议开启） */
  contextReset?: boolean;
  /** Context reset 间隔（每N个任务重置一次，0=从不） */
  contextResetInterval?: number;
}

export interface TaskState {
  sprintNumber: number;
  status: 'pending' | 'in_progress' | 'passed' | 'failed';
  retries: number;
  lastError?: string;
  completedAt?: string;
}

export interface LoopState {
  tasks: TaskState[];
  currentTaskIndex: number;
  totalIterations: number;
  startedAt: string;
  lastActivityAt: string;
}

// ============= 常量 =============

const LOOP_STATE_FILE = '.ralph-loop-state.json';

// ============= Ralph Wiggum Loop =============

export class RalphWiggumLoop {
  private config: RalphLoopConfig;
  private state: LoopState;
  private eventBus: EventBus;
  private abortController: AbortController | null = null;

  constructor(config: RalphLoopConfig) {
    this.config = {
      ...config,
      maxIterations: config.maxIterations || 50,
      maxRetriesPerTask: config.maxRetriesPerTask || 3,
    };
    this.eventBus = config.eventBus || new EventBus(config.projectDir);
    this.state = this.loadState();
  }

  /**
   * 从 Sprint 列表初始化任务
   */
  initTasks(sprints: SprintContract[]): void {
    this.state.tasks = sprints.map(s => ({
      sprintNumber: s.sprintNumber,
      status: 'pending' as const,
      retries: 0,
    }));
    this.state.currentTaskIndex = 0;
    this.state.totalIterations = 0;
    this.saveState();
  }

  /**
   * 执行循环（主要入口）
   * 
   * @param executeTask 任务执行函数——由外部注入
   * @returns 通过的任务数量
   */
  async run(
    executeTask: (sprint: SprintContract, retry: number, lastError?: string) => Promise<{
      passed: boolean;
      report?: SupervisorReport;
      error?: string;
    }>,
    getSprint: (sprintNumber: number) => SprintContract | undefined
  ): Promise<{ passed: number; failed: number; total: number }> {
    console.log('\n🔄 Ralph Wiggum Loop 启动');
    console.log(`   模式: ${this.config.mode} | 引擎: ${this.config.engine}`);
    console.log(`   任务数: ${this.state.tasks.length} | 最大迭代: ${this.config.maxIterations}`);
    console.log(`   熔断: 每任务${this.config.maxRetriesPerTask}次重试\n`);

    this.abortController = new AbortController();
    let passed = 0;
    let failed = 0;

    for (let i = this.state.currentTaskIndex; i < this.state.tasks.length; i++) {
      if (this.abortController.signal.aborted) break;

      const task = this.state.tasks[i];
      const sprint = getSprint(task.sprintNumber);
      if (!sprint) {
        console.log(`⚠️ Sprint ${task.sprintNumber} 未找到，跳过`);
        continue;
      }

      task.status = 'in_progress';
      this.state.currentTaskIndex = i;
      this.saveState();

      // Context Reset（针对 DeepSeek 等需要重置的模型）
      if (this.config.contextReset) {
        const interval = this.config.contextResetInterval || 1;
        if ((i - this.state.tasks.findIndex(t => t.status === 'passed')) % interval === 0) {
          console.log(`🔄 [Context Reset] Sprint ${task.sprintNumber} — 清理上下文`);
          // 写入状态文件供下一个 Agent 读取（Anthropic 官方推荐的 handoff 机制）
          writeFileSync(
            join(this.config.projectDir, '.ralph-context.json'),
            JSON.stringify({
              lastTask: task.sprintNumber,
              passedTasks: this.state.tasks.filter(t => t.status === 'passed').map(t => t.sprintNumber),
              nextTask: sprint?.objectives?.[0] || '',
              timestamp: new Date().toISOString(),
            }, null, 2)
          );
        }
      }

      // 按你的期望：每个任务启动 Agent → 验证 → 修复 → 重验证
      let taskPassed = false;

      for (let retry = 0; retry < this.config.maxRetriesPerTask && !taskPassed; retry++) {
        if (this.abortController.signal.aborted) break;

        this.state.totalIterations++;
        task.retries = retry;

        // Ralph Wiggum 核心：执行任务
        console.log(`\n${'─'.repeat(40)}`);
        console.log(`🎯 Sprint ${task.sprintNumber} | 尝试 ${retry + 1}/${this.config.maxRetriesPerTask}`);
        console.log(`${'─'.repeat(40)}`);

        this.eventBus.emit('sprint:started', 'ralph-loop', {
          sprintNumber: task.sprintNumber,
          retry,
          projectId: this.config.projectId,
        });

        try {
          const result = await executeTask(sprint, retry, task.lastError);

          if (result.passed) {
            taskPassed = true;
            task.status = 'passed';
            task.completedAt = new Date().toISOString();
            passed++;

            this.eventBus.emit('sprint:passed', 'ralph-loop', {
              sprintNumber: task.sprintNumber,
              retries: retry,
              projectId: this.config.projectId,
            });

            console.log(`✅ Sprint ${task.sprintNumber} 通过! (${retry + 1}次尝试)`);
          } else {
            task.lastError = result.error || '评估未通过';
            this.eventBus.emit('sprint:rejected', 'ralph-loop', {
              sprintNumber: task.sprintNumber,
              retry,
              error: task.lastError,
              projectId: this.config.projectId,
            });

            console.log(`❌ Sprint ${task.sprintNumber} 失败: ${task.lastError}`);
          }

        } catch (error) {
          task.lastError = String(error);
          console.error(`💥 Sprint ${task.sprintNumber} 异常:`, error);
        }

        this.saveState();
      }

      if (!taskPassed) {
        task.status = 'failed';
        failed++;
        console.log(`\n⚠️ Sprint ${task.sprintNumber} 未通过（${this.config.maxRetriesPerTask}次重试已用完）`);
      }

      // 熔断检查
      if (this.state.totalIterations >= this.config.maxIterations) {
        console.log(`\n🛑 熔断: 达到最大迭代次数 ${this.config.maxIterations}`);
        break;
      }
    }

    this.state.lastActivityAt = new Date().toISOString();
    this.saveState();

    // 输出摘要
    console.log(`\n${'═'.repeat(40)}`);
    console.log(`🏁 Ralph Loop 完成: ${passed}通过 / ${failed}失败 / ${this.state.tasks.length}总计`);
    console.log(`   总迭代: ${this.state.totalIterations}`);
    console.log(`${'═'.repeat(40)}\n`);

    return { passed, failed, total: this.state.tasks.length };
  }

  /**
   * 使用 Ralphy CLI 作为外部引擎执行
   */
  async runWithRalphy(prdPath: string): Promise<{ passed: number; failed: number }> {
    console.log('\n🚀 Ralphy CLI 模式启动...');

    const args = [
      '--codex',
      '--prd', prdPath,
      '--parallel',
      '--max-parallel', '3',
      '--max-iterations', String(this.state.tasks.length),
      '--max-retries', String(this.config.maxRetriesPerTask),
    ];

    try {
      const result = await execCommand('ralphy', args, {
        cwd: this.config.projectDir,
        timeout: 3600000, // 1小时总超时
      });

      if (result.success) {
        console.log('✅ Ralphy 执行完成');
        return { passed: this.state.tasks.length, failed: 0 };
      } else {
        console.error('❌ Ralphy 执行失败:', result.stderr);
        return { passed: 0, failed: this.state.tasks.length };
      }
    } catch (error) {
      console.error('💥 Ralphy 异常:', error);
      return { passed: 0, failed: this.state.tasks.length };
    }
  }

  /**
   * 停止循环
   */
  abort(): void {
    this.abortController?.abort();
    console.log('\n⏹️ Ralph Loop 已中止');
  }

  /**
   * 获取进度摘要
   */
  getProgress(): string {
    const passed = this.state.tasks.filter(t => t.status === 'passed').length;
    const inProgress = this.state.tasks.filter(t => t.status === 'in_progress').length;
    const failed = this.state.tasks.filter(t => t.status === 'failed').length;
    const pending = this.state.tasks.filter(t => t.status === 'pending').length;

    const bar = this.makeBar(passed, this.state.tasks.length || 1);

    return `🔄 Ralph Loop 进度
${bar} ${passed}/${this.state.tasks.length} Sprint
✅${passed} 🔄${inProgress} ❌${failed} ⏳${pending}
迭代: ${this.state.totalIterations}/${this.config.maxIterations}`;
  }

  // ========== 内部 ==========

  private loadState(): LoopState {
    const file = join(this.config.projectDir, LOOP_STATE_FILE);
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch {}
    }
    return {
      tasks: [],
      currentTaskIndex: 0,
      totalIterations: 0,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
  }

  private saveState(): void {
    mkdirSync(this.config.projectDir, { recursive: true });
    writeFileSync(
      join(this.config.projectDir, LOOP_STATE_FILE),
      JSON.stringify(this.state, null, 2)
    );
  }

  private makeBar(current: number, total: number): string {
    const w = 15;
    const filled = Math.round((current / total) * w);
    return '█'.repeat(filled) + '░'.repeat(w - filled);
  }
}
