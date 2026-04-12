/**
 * Convergence Detector - 收敛检测逻辑
 *
 * 检测何时应该：
 * 1. 继续迭代
 * 2. 停止（真正退出）
 * 3. 进入自主挖掘模式
 * 4. 回滚
 */

import type {
  ConvergenceStatus,
  ConvergenceSignal,
  IterationSnapshot,
  SupervisorReport
} from './types.js';

// ============= 常量 =============

/**
 * 连续无改进次数阈值（触发自主挖掘）
 */
const NO_IMPROVEMENT_THRESHOLD = 2;

/**
 * 分数变化阈值（判断改善/劣化）
 */
const SIGNIFICANT_CHANGE_THRESHOLD = 0.5;

/**
 * 自主挖掘最大次数
 */
const MAX_AUTONOMOUS_EXPLORATION = 2;

/**
 * 用户停止关键词
 */
const STOP_KEYWORDS = [
  '停止', '停', 'stop', '结束', 'exit', 'quit',
  '满意了', 'satisfied', '够了', 'enough',
  '可以了', 'done', '完成', 'finished'
];

// ============= 核心检测 =============

/**
 * 检测收敛状态
 */
export function detectConvergence(
  history: IterationSnapshot[],
  userMessage: string = '',
  autonomousExplorationCount: number = 0
): ConvergenceStatus {
  // 规则 1: 用户明确要求停止（唯一真正的停止条件）
  if (containsStopSignal(userMessage)) {
    return createStatus('STOP', '用户明确要求停止');
  }

  // 规则 2: 核心功能劣化 → 回滚
  if (history.length >= 2) {
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];

    if (latest.totalScore < previous.totalScore - SIGNIFICANT_CHANGE_THRESHOLD) {
      return createStatus('ROLLBACK', `质量劣化检测: ${previous.totalScore.toFixed(1)} → ${latest.totalScore.toFixed(1)}`);
    }
  }

  // 规则 3: 连续 N 轮无价值提升 → 自主挖掘
  const consecutiveNoImprovement = countConsecutiveNoImprovement(history);
  if (consecutiveNoImprovement >= NO_IMPROVEMENT_THRESHOLD) {
    if (autonomousExplorationCount < MAX_AUTONOMOUS_EXPLORATION) {
      return createStatus('EXPLORE', `连续 ${consecutiveNoImprovement} 轮无价值提升，进入自主挖掘模式`, consecutiveNoImprovement);
    } else {
      return createStatus('STOP', `连续 ${consecutiveNoImprovement} 轮无改进，自主挖掘 ${autonomousExplorationCount} 次后仍无方向`, consecutiveNoImprovement);
    }
  }

  // 规则 4: 质量趋势分析
  const qualityTrend = calculateQualityTrend(history);

  // 规则 5: 检查是否达成目标
  if (history.length > 0) {
    const latest = history[history.length - 1];
    if (latest.totalScore >= 9.5 && latest.dimensionScores.productDepth >= 9.0) {
      return createStatus('STOP', '产品已接近完美，继续迭代收益递减');
    }
  }

  // 默认: 继续
  return createStatus('CONTINUE', '正常迭代', consecutiveNoImprovement, qualityTrend);
}

/**
 * 检测用户停止信号
 */
function containsStopSignal(message: string): boolean {
  if (!message) return false;

  const lowerMessage = message.toLowerCase();
  return STOP_KEYWORDS.some(keyword =>
    lowerMessage.includes(keyword.toLowerCase())
  );
}

/**
 * 计算连续无改进轮次
 */
function countConsecutiveNoImprovement(history: IterationSnapshot[]): number {
  if (history.length === 0) return 0;

  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!history[i].valueImprovement) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * 计算质量趋势
 */
function calculateQualityTrend(history: IterationSnapshot[]): 'improving' | 'stable' | 'degrading' {
  if (history.length < 2) return 'stable';

  // 取最近 5 轮
  const recentScores = history
    .slice(-5)
    .map(h => h.totalScore);

  if (recentScores.length < 2) return 'stable';

  // 简单线性趋势
  const recent = recentScores.slice(-2);
  const delta = recent[1] - recent[0];

  if (delta > SIGNIFICANT_CHANGE_THRESHOLD) {
    return 'improving';
  }
  if (delta < -SIGNIFICANT_CHANGE_THRESHOLD) {
    return 'degrading';
  }
  return 'stable';
}

/**
 * 创建收敛状态
 */
function createStatus(
  signal: ConvergenceSignal,
  reason: string,
  consecutiveNoImprovement: number = 0,
  qualityTrend: 'improving' | 'stable' | 'degrading' = 'stable'
): ConvergenceStatus {
  return {
    signal,
    reason,
    consecutiveNoImprovement,
    qualityTrend,
    shouldStop: signal === 'STOP'
  };
}

// ============= 快照管理 =============

/**
 * 从 Supervisor 报告创建快照
 */
export function createSnapshot(
  iteration: number,
  report: SupervisorReport,
  valueImprovement: boolean
): IterationSnapshot {
  return {
    iteration,
    totalScore: report.totalScore,
    dimensionScores: { ...report.dimensionScores },
    valueImprovement,
    verdict: report.verdict
  };
}

/**
 * 判断是否有价值提升
 */
export function hasValueImprovement(
  current: IterationSnapshot | null,
  previous: IterationSnapshot | null
): boolean {
  if (!current || !previous) return true; // 首次认为有提升

  // 分数提升
  if (current.totalScore > previous.totalScore + 0.1) {
    return true;
  }

  // 核心维度提升
  if (current.dimensionScores.productDepth > previous.dimensionScores.productDepth) {
    return true;
  }

  return false;
}

// ============= 决策建议 =============

/**
 * 根据收敛状态获取下一步建议
 */
export function getNextActionAdvice(status: ConvergenceStatus): string {
  switch (status.signal) {
    case 'STOP':
      return '结束循环，汇报结果给用户';

    case 'ROLLBACK':
      return '触发回滚机制，修复后继续';

    case 'EXPLORE':
      return '进入自主挖掘模式，寻找新的优化方向';

    case 'CONTINUE':
      if (status.qualityTrend === 'improving') {
        return '继续当前方向，深化优化';
      } else if (status.qualityTrend === 'degrading') {
        return '质量下降，考虑切换方向';
      }
      return '继续正常迭代';

    default:
      return '继续迭代';
  }
}

/**
 * 生成迭代摘要
 */
export function generateIterationSummary(
  iteration: number,
  currentSnapshot: IterationSnapshot,
  previousSnapshot: IterationSnapshot | null,
  status: ConvergenceStatus
): string {
  const lines: string[] = [
    `=== 迭代 ${iteration} 摘要 ===`,
    `总分: ${currentSnapshot.totalScore.toFixed(1)}/10`,
    `  - 产品深度: ${currentSnapshot.dimensionScores.productDepth}/10`,
    `  - 用户体验: ${currentSnapshot.dimensionScores.userExperience}/10`,
    `  - 代码质量: ${currentSnapshot.dimensionScores.codeQuality}/10`,
    `  - 安全合规: ${currentSnapshot.dimensionScores.security}/10`,
    `裁决: ${currentSnapshot.verdict}`,
    `收敛: ${status.signal} - ${status.reason}`
  ];

  if (previousSnapshot) {
    const delta = currentSnapshot.totalScore - previousSnapshot.totalScore;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
    lines.push(`分数变化: ${deltaStr}`);
  }

  return lines.join('\n');
}

// ============= 自主挖掘 =============

/**
 * 生成自主挖掘任务
 */
export function generateAutonomousExplorationTasks(
  currentSnapshot: IterationSnapshot,
  projectContext: string
): string[] {
  const tasks: string[] = [];

  // 1. 分析短板
  const weakestDimension = findWeakestDimension(currentSnapshot.dimensionScores);
  if (weakestDimension) {
    tasks.push(`深度优化 ${weakestDimension} 维度`);
  }

  // 2. 搜索竞品
  tasks.push('搜索同类产品的最佳实践');

  // 3. 用户体验审计
  tasks.push('进行完整的用户体验审计');

  // 4. 性能优化
  if (currentSnapshot.dimensionScores.codeQuality < 8) {
    tasks.push('代码质量深度优化');
  }

  return tasks;
}

/**
 * 找到最弱的维度
 */
function findWeakestDimension(scores: {
  productDepth: number;
  userExperience: number;
  codeQuality: number;
  security: number;
}): string | null {
  const entries = [
    { name: '产品深度', score: scores.productDepth },
    { name: '用户体验', score: scores.userExperience },
    { name: '代码质量', score: scores.codeQuality },
    { name: '安全合规', score: scores.security }
  ];

  entries.sort((a, b) => a.score - b.score);
  return entries[0].score < 7 ? entries[0].name : null;
}

/**
 * 决定下一步迭代方向
 */
export function decideNextDirection(
  history: IterationSnapshot[],
  explorationTasks: string[]
): string {
  if (explorationTasks.length === 0) {
    return '继续深化现有功能';
  }

  // 取最影响分的任务
  return explorationTasks[0];
}
