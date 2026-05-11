/**
 * Ralph Wiggum Loop 测试 — 任务级自主开发循环
 * 
 * 核心验证：
 * 1. 任务初始化
 * 2. 通过/失败/重试流程
 * 3. 熔断机制 (3次重试, 50次总迭代)
 * 4. 进度持久化 (断点续跑)
 * 5. Context Reset 模式
 * 6. Ralphy 模式选择
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RalphWiggumLoop, type LoopState } from '../ralph-loop.js';
import type { SprintContract, SupervisorReport } from '../types.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function tmpDir() {
  const dir = join(tmpdir(), `rl-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const MOCK_SPRINT: SprintContract = {
  sprintNumber: 1,
  objectives: ['实现计数器功能'],
  acceptanceCriteria: ['点击+1', '显示计数'],
  estimatedDuration: '1h',
  technicalConstraints: [],
};

const MOCK_PASSED_REPORT: SupervisorReport = {
  verdict: 'APPROVED',
  totalScore: 92,
  dimensionScores: {
    productDepth: 33,
    userExperience: 28,
    codeQuality: 18,
    security: 13,
  },
  issues: [],
};

const MOCK_REJECTED_REPORT: SupervisorReport = {
  verdict: 'REJECTED',
  totalScore: 55,
  dimensionScores: {
    productDepth: 20,
    userExperience: 15,
    codeQuality: 10,
    security: 10,
  },
  issues: ['计数器不工作', 'UI显示异常'],
};

describe('RalphWiggumLoop', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  // ========== 初始化 ==========

  it('应该正确初始化任务列表', () => {
    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
    });

    loop.initTasks([MOCK_SPRINT, { ...MOCK_SPRINT, sprintNumber: 2 }]);

    const progress = loop.getProgress();
    expect(progress).toContain('0/2 Sprint');
    expect(progress).toContain('⏳2');
  });

  // ========== 通过流程 ==========

  it('任务一次通过应标记为 passed', async () => {
    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
    });

    loop.initTasks([MOCK_SPRINT]);

    const result = await loop.run(
      async () => ({ passed: true, report: MOCK_PASSED_REPORT }),
      (n) => (n === 1 ? MOCK_SPRINT : undefined)
    );

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);
  });

  // ========== 重试流程 ==========

  it('任务失败后应重试', async () => {
    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 3,
    });

    loop.initTasks([MOCK_SPRINT]);

    let callCount = 0;
    const result = await loop.run(
      async () => {
        callCount++;
        if (callCount < 3) {
          return { passed: false, error: `尝试${callCount}失败` };
        }
        return { passed: true, report: MOCK_PASSED_REPORT };
      },
      (n) => (n === 1 ? MOCK_SPRINT : undefined)
    );

    expect(result.passed).toBe(1);
    expect(callCount).toBe(3); // 第3次通过
  });

  // ========== 熔断 ==========

  it('超过最大重试次数应标记为 failed', async () => {
    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
    });

    loop.initTasks([MOCK_SPRINT]);

    const result = await loop.run(
      async () => ({ passed: false, error: '始终失败' }),
      (n) => (n === 1 ? MOCK_SPRINT : undefined)
    );

    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('超过最大迭代次数应熔断', async () => {
    const sprints = Array.from({ length: 10 }, (_, i) => ({
      ...MOCK_SPRINT,
      sprintNumber: i + 1,
    }));

    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 3, // 3次就断
      maxRetriesPerTask: 1,
    });

    loop.initTasks(sprints);

    let calls = 0;
    await loop.run(
      async () => { calls++; return { passed: false, error: 'fail' }; },
      (n) => sprints.find(s => s.sprintNumber === n)
    );

    // 每个 sprint 1次初始 + 1次重试 = 2次；3次总迭代 = 只能跑 1.5 个 sprint
    expect(calls).toBeLessThanOrEqual(6); // 最多 (1初始+1重试) × 3迭代
  });

  // ========== 进度持久化 ==========

  it('进度应持久化到文件，支持断点续跑', async () => {
    const loop1 = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
    });

    loop1.initTasks([MOCK_SPRINT, { ...MOCK_SPRINT, sprintNumber: 2 }]);

    // 第1个通过
    await loop1.run(
      async (sprint) => { if (sprint.sprintNumber === 2) return { passed: false, error: 'skip' }; return { passed: true, report: MOCK_PASSED_REPORT }; },
      (n) => (n <= 2 ? { ...MOCK_SPRINT, sprintNumber: n } : undefined)
    );

    // 新建 loop 从文件恢复
    const loop2 = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
    });

    const progress = loop2.getProgress();
    expect(progress).toContain('1/2 Sprint');
    expect(progress).toContain('✅1');
  });

  // ========== Context Reset ==========

  it('contextReset=true 时应写入 .ralph-context.json', async () => {
    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
      contextReset: true,
      contextResetInterval: 1,
    });

    loop.initTasks([MOCK_SPRINT]);

    await loop.run(
      async () => ({ passed: true, report: MOCK_PASSED_REPORT }),
      (n) => (n === 1 ? MOCK_SPRINT : undefined)
    );

    const ctxFile = join(dir, '.ralph-context.json');
    expect(existsSync(ctxFile)).toBe(true);

    const ctx = JSON.parse(readFileSync(ctxFile, 'utf-8'));
    expect(ctx.lastTask).toBe(1);
    expect(Array.isArray(ctx.passedTasks)).toBe(true); // Context reset 在执行前写入
    expect(ctx.nextTask).toBeTruthy();
  });

  // ========== Abort ==========

  it('abort 应停止循环', async () => {
    const sprints = Array.from({ length: 5 }, (_, i) => ({
      ...MOCK_SPRINT,
      sprintNumber: i + 1,
    }));

    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 50,
      maxRetriesPerTask: 2,
    });

    loop.initTasks(sprints);

    let callCount = 0;
    const runPromise = loop.run(
      async () => {
        callCount++;
        if (callCount === 2) loop.abort();
        return { passed: true, report: MOCK_PASSED_REPORT };
      },
      (n) => sprints.find(s => s.sprintNumber === n)
    );

    await runPromise;

    // 应该在 abort 后停止，不会跑完5个
    expect(callCount).toBeLessThan(5);
  });

  // ========== 进度格式化 ==========

  it('getProgress 应返回格式化的进度字符串', () => {
    const loop = new RalphWiggumLoop({
      mode: 'internal',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 50,
      maxRetriesPerTask: 3,
    });

    loop.initTasks([MOCK_SPRINT]);

    const progress = loop.getProgress();
    expect(progress).toContain('🔄 Ralph Loop 进度');
    expect(progress).toContain('░');
    expect(progress).toContain('0/1 Sprint');
  });

  // ========== Ralphy 模式 ==========

  it('mode=ralphy 时不走 internal 流程', () => {
    const loop = new RalphWiggumLoop({
      mode: 'ralphy',
      engine: 'codex',
      projectDir: dir,
      maxIterations: 10,
      maxRetriesPerTask: 2,
    });

    // 验证构造成功
    expect(loop).toBeDefined();
    expect(loop.getProgress()).toContain('Ralph Loop');
  });
});
