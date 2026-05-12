import type { AgentEngine } from './utils/agent-executor.js';
/**
 * Snake-of-Mercury 类型定义
 * 核心类型系统定义
 */

// ============= Phase 状态 =============

export type Phase = 'phase0' | 'phase1' | 'phase2' | 'phase3';

export interface PhaseState {
  phase: Phase;
  iteration: number;
  converged: boolean;
  convergedReason?: string;
}

// ============= Phase 0: 产品创新 =============

/**
 * 创新类型枚举
 */
export type InnovationType = 'disruptive' | 'incremental' | 'unknown';

/**
 * 决策卡点类型
 */
export type DecisionBlockerType = 'requirement' | 'technology' | 'business' | 'scaling' | 'unknown';

/**
 * 六字段状态
 */
export interface SixFieldProgress {
  innovationType: 'empty' | 'in_progress' | 'completed';
  decisionBlocker: 'empty' | 'in_progress' | 'completed';
  problemDefinition: 'empty' | 'in_progress' | 'completed';
  jtbd: 'empty' | 'in_progress' | 'completed';
  alternatives: 'empty' | 'in_progress' | 'completed';
  riskAssumptions: 'empty' | 'in_progress' | 'completed';
}

/**
 * 问卷进度状态
 */
export interface QuestionnaireState {
  originalRequirement: string;
  currentRound: number;
  maxRounds: number;
  sixFields: SixFieldProgress;
  // 已填充的字段值
  innovationType?: InnovationType;
  decisionBlocker?: DecisionBlockerType;
  problemDefinition?: string;
  jtbd?: string;
  alternatives?: string;
  riskAssumptions?: string[];
  // 是否已通过第一轮创新类型判断
  innovationTypeAsked: boolean;
  // 是否已通过决策卡点定位
  decisionBlockerAsked: boolean;
}

/**
 * 追问响应
 */
export interface QuestionnaireResponse {
  question: string;
  options: string[];
  selectedOption?: string;
  fieldUpdated?: keyof SixFieldProgress;
}

/**
 * 问题定义
 */
export interface ProblemDefinition {
  contextSnapshot: string;
  problemStatement: string;
  jtbd: string;
  currentAlternatives: string;
  evidenceAndAssumptions: string[];
  successCriteria: string[];
  scopeBoundaries: {
    inScope: string[];
    outOfScope: string[];
  };
  prototypePlan: string;
}

export interface AgentOutput {
  agentName: string;
  content: string;
  challenges?: string[];
  responses?: string[];
}

export interface DebateResult {
  convergedRequirement: string;
  acceptanceCriteria: string[];
  agentOutputs: AgentOutput[];
  commonGround: string[];
  keyDisagreements: string[];
  finalDecisions: string[];
}

// ============= Phase 1: 规划 =============

export interface SprintContract {
  sprintNumber: number;
  objectives: string[];
  acceptanceCriteria: string[];
  estimatedDuration: string;
  technicalConstraints: string[];
}

export interface ProductSpec {
  overview: string;
  featureList: {
    must: string[];
    should: string[];
    could: string[];
  };
  sprintPlan: SprintContract[];
  technicalDirection: string;
  acceptanceStandards: string[];
}

// ============= Phase 2: 开发 =============

export type SupervisorVerdict = 'APPROVED' | 'REJECTED' | 'ROLLBACK';

export interface FourDimensionScores {
  productDepth: number;      // 产品深度 (35%)
  userExperience: number;    // 用户体验 (30%)
  codeQuality: number;       // 代码质量 (20%)
  security: number;          // 安全合规 (15%)
}

export interface SupervisorReport {
  verdict: SupervisorVerdict;
  totalScore: number;
  dimensionScores: FourDimensionScores;
  issues: string[];
 修复建议?: string[];
  evaluatorBiasWarnings?: string[];
}

export interface IterationSnapshot {
  iteration: number;
  totalScore: number;
  dimensionScores: FourDimensionScores;
  valueImprovement: boolean;
  verdict: SupervisorVerdict;
}

// ============= Phase 3: 交付 =============

export interface DeploymentResult {
  success: boolean;
  deployedUrl?: string;
  error?: string;
  timestamp: string;
}

export interface CanaryReport {
  healthy: boolean;
  metrics: {
    latency?: number;
    errorRate?: number;
    uptime?: number;
  };
  warnings: string[];
  timestamp: string;
}

// ============= 收敛检测 =============

export type ConvergenceSignal = 'CONTINUE' | 'STOP' | 'EXPLORE' | 'ROLLBACK';

export interface ConvergenceStatus {
  signal: ConvergenceSignal;
  reason: string;
  consecutiveNoImprovement: number;
  qualityTrend: 'improving' | 'stable' | 'degrading';
  shouldStop: boolean;
}

export interface HarnessState {
  version: string;
  projectName: string;
  originalRequirement: string;
  currentPhase: Phase;
  iterationCount: number;
  phase0Output?: {
    problemDefinition: ProblemDefinition;
    debateResult: DebateResult;
  };
  phase1Output?: {
    spec: ProductSpec;
  };
  phase2Output?: {
    currentSprint: number;
    sprintResults: SupervisorReport[];
  };
  phase3Output?: {
    deployed: boolean;
    canaryResult?: CanaryReport;
  };
  convergenceStatus: ConvergenceStatus;
  pivotHistory: {
    iteration: number;
    strategy: string;
    score: number;
    direction: string;
  }[];
  lastUpdated: string;
}

// ============= 配置 =============

export interface HarnessConfig {
  requirement: string;
  projectDir: string;
  maxIterations: number;
  model?: string;
  engine?: AgentEngine;
  autoDeploy?: boolean;
}

// ============= 工具调用类型 =============

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
}

// ============= Agent 团队 =============

export interface TeamConfig {
  teamName: string;
  agents: string[];
  iterationId: number;
}

export interface DebateRound {
  round: 1 | 2 | 3;
  challenges?: Map<string, string>;
  responses?: Map<string, string>;
  synthesis?: string;
}
