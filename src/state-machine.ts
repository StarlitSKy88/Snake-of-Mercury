/**
 * State Machine - Phase 状态管理
 * 管理 Phase 0/1/2/3 的状态转换
 */

import type { Phase, PhaseState, HarnessState, HarnessConfig } from './types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * 创建初始状态
 */
export function createInitialState(config: HarnessConfig): HarnessState {
  return {
    version: '2.0',
    projectName: config.projectDir.split('/').pop() || 'unnamed',
    originalRequirement: config.requirement,
    currentPhase: 'phase0',
    iterationCount: 1,
    convergenceStatus: {
      signal: 'CONTINUE',
      reason: 'Initial state',
      consecutiveNoImprovement: 0,
      qualityTrend: 'stable',
      shouldStop: false
    },
    pivotHistory: [],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * 加载状态（如果存在）
 */
export function loadState(stateFilePath: string): HarnessState | null {
  if (!existsSync(stateFilePath)) {
    return null;
  }
  try {
    const content = readFileSync(stateFilePath, 'utf-8');
    return JSON.parse(content) as HarnessState;
  } catch {
    return null;
  }
}

/**
 * 保存状态到文件
 */
export function saveState(stateFilePath: string, state: HarnessState): void {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 获取下一个 Phase
 */
export function getNextPhase(currentPhase: Phase): Phase {
  const phaseOrder: Phase[] = ['phase0', 'phase1', 'phase2', 'phase3'];
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const nextIndex = (currentIndex + 1) % phaseOrder.length;
  return phaseOrder[nextIndex];
}

/**
 * 是否应该进入下一轮迭代
 */
export function shouldAdvanceToNextIteration(phase: Phase): boolean {
  return phase === 'phase3';
}

/**
 * Phase 转换的标签
 */
export function getPhaseLabel(phase: Phase): string {
  const labels: Record<Phase, string> = {
    phase0: '产品创新',
    phase1: 'Harness 规划',
    phase2: 'Harness 开发',
    phase3: '交付阶段'
  };
  return labels[phase];
}

/**
 * Phase 执行时间预估（用于日志）
 */
export function getPhaseEstimatedDuration(phase: Phase): string {
  const durations: Record<Phase, string> = {
    phase0: '5-10 分钟',
    phase1: '2-3 分钟',
    phase2: '10-30 分钟',
    phase3: '3-5 分钟'
  };
  return durations[phase];
}

/**
 * 验证状态完整性
 */
export function validateState(state: HarnessState): string[] {
  const errors: string[] = [];

  if (!state.version) {
    errors.push('Missing version');
  }

  if (!state.originalRequirement) {
    errors.push('Missing original requirement');
  }

  if (state.iterationCount < 1) {
    errors.push('Invalid iteration count');
  }

  const validPhases: Phase[] = ['phase0', 'phase1', 'phase2', 'phase3'];
  if (!validPhases.includes(state.currentPhase)) {
    errors.push(`Invalid current phase: ${state.currentPhase}`);
  }

  return errors;
}

/**
 * 创建状态快照（用于比较）
 */
export function createPhaseSnapshot(state: HarnessState): Partial<HarnessState> {
  return {
    version: state.version,
    projectName: state.projectName,
    originalRequirement: state.originalRequirement,
    currentPhase: state.currentPhase,
    iterationCount: state.iterationCount,
    convergenceStatus: state.convergenceStatus,
    lastUpdated: state.lastUpdated
  };
}

/**
 * 计算迭代进度
 */
export function getIterationProgress(state: HarnessState, maxIterations: number): string {
  return `${state.iterationCount}/${maxIterations}`;
}

/**
 * 格式化状态摘要
 */
export function formatStateSummary(state: HarnessState): string {
  const lines: string[] = [
    `项目: ${state.projectName}`,
    `需求: ${state.originalRequirement}`,
    `当前阶段: ${getPhaseLabel(state.currentPhase)} (迭代 ${state.iterationCount})`,
    `收敛状态: ${state.convergenceStatus.signal}`,
    `收敛原因: ${state.convergenceStatus.reason}`
  ];

  if (state.convergenceStatus.consecutiveNoImprovement > 0) {
    lines.push(`连续无改进轮次: ${state.convergenceStatus.consecutiveNoImprovement}`);
  }

  if (state.pivotHistory.length > 0) {
    lines.push(`Pivot 历史: ${state.pivotHistory.length} 次`);
  }

  return lines.join('\n');
}
