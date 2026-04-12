/**
 * Phase 0 追问收敛模块 - 苏格拉底式强制选择提问
 *
 * 实现 Sprint 1 核心功能：
 * 1. 创新类型判断节点 - 第一轮必须问"颠覆式还是渐进式"
 * 2. 决策卡点定位器 - 问"最大的卡点是什么"
 * 3. 强制选择式追问引擎 - 不允许无限开放式问答
 *
 * 六字段状态机：
 * - innovationType: 创新类型（颠覆式/渐进式/未知）
 * - decisionBlocker: 决策卡点（需求/技术/商业/规模化/未知）
 * - problemDefinition: 问题定义
 * - jtbd: 用户待办任务
 * - alternatives: 替代方案
 * - riskAssumptions: 风险假设
 */

import type {
  InnovationType,
  DecisionBlockerType,
  QuestionnaireState,
  QuestionnaireResponse,
  SixFieldProgress,
  ProblemDefinition
} from './types.js';

// ============= 常量 =============

const MAX_ROUNDS = 3;

/**
 * 创新类型选项
 */
const INNOVATION_TYPE_OPTIONS = [
  '颠覆式改变游戏规则',
  '渐进式改进现有方案'
] as const;

/**
 * 决策卡点选项
 */
const DECISION_BLOCKER_OPTIONS = [
  '需求不清晰，不知道要做成什么样',
  '技术方案不确定，不知道怎么实现',
  '商业模式不清晰，不知道怎么赚钱',
  '规模化挑战，不确定能否做大'
] as const;

// ============= 核心函数 =============

/**
 * 创建初始问卷状态
 */
export function createInitialQuestionnaireState(requirement: string): QuestionnaireState {
  return {
    originalRequirement: requirement,
    currentRound: 1,
    maxRounds: MAX_ROUNDS,
    sixFields: {
      innovationType: 'empty',
      decisionBlocker: 'empty',
      problemDefinition: 'empty',
      jtbd: 'empty',
      alternatives: 'empty',
      riskAssumptions: 'empty'
    },
    innovationTypeAsked: false,
    decisionBlockerAsked: false
  };
}

/**
 * 检查是否可以输出分析结论
 * 验收标准：未问创新类型判断问题，系统拒绝输出任何分析结论
 */
export function canOutputAnalysis(state: QuestionnaireState): {
  allowed: boolean;
  reason: string;
} {
  if (!state.innovationTypeAsked) {
    return {
      allowed: false,
      reason: '系统必须在第一轮问"颠覆式还是渐进式"，未问此问题不能输出分析结论'
    };
  }
  if (!state.decisionBlockerAsked) {
    return {
      allowed: false,
      reason: '系统必须问"你现在最大的卡点是什么"，未问此问题不能输出分析结论'
    };
  }
  return { allowed: true, reason: '已通过创新类型和决策卡点验证' };
}

/**
 * 获取下一个问题（苏格拉底式强制选择提问）
 * 规则：第一轮必须问创新类型，第二轮必须问决策卡点
 */
export function getNextQuestion(state: QuestionnaireState): QuestionnaireResponse {
  // 第一轮：必须问创新类型
  if (!state.innovationTypeAsked) {
    return {
      question: '您想要的创新类型是哪种？',
      options: [...INNOVATION_TYPE_OPTIONS],
      fieldUpdated: 'innovationType'
    };
  }

  // 第二轮：必须问决策卡点
  if (!state.decisionBlockerAsked) {
    return {
      question: '您现在最大的卡点是什么？',
      options: [...DECISION_BLOCKER_OPTIONS],
      fieldUpdated: 'decisionBlocker'
    };
  }

  // 后续：根据未完成的字段继续追问
  const incompleteFields = getIncompleteFields(state.sixFields);
  if (incompleteFields.length > 0) {
    return buildFollowUpQuestion(incompleteFields[0], state);
  }

  // 所有字段都已完成
  return {
    question: '信息收集完成！',
    options: ['继续生成分析结论'],
    fieldUpdated: undefined
  };
}

/**
 * 处理用户响应，更新状态
 * 添加输入验证，确保选项合法
 */
export function processUserResponse(
  state: QuestionnaireState,
  selectedOption: string
): QuestionnaireState {
  // 输入验证：检查选项是否为空
  if (!selectedOption || typeof selectedOption !== 'string') {
    console.warn('[Questionnaire] 警告: 收到无效的选项输入');
    return state;
  }

  // 创建不可变更新
  const newState = { ...state };

  // 处理创新类型
  if (!state.innovationTypeAsked) {
    const innovationType = mapToInnovationType(selectedOption);
    newState.innovationType = innovationType;
    newState.innovationTypeAsked = true;
    newState.sixFields = {
      ...state.sixFields,
      innovationType: 'completed'
    };
    return newState;
  }

  // 处理决策卡点
  if (!state.decisionBlockerAsked) {
    const decisionBlocker = mapToDecisionBlocker(selectedOption);
    newState.decisionBlocker = decisionBlocker;
    newState.decisionBlockerAsked = true;
    newState.sixFields = {
      ...state.sixFields,
      decisionBlocker: 'completed'
    };
    return newState;
  }

  // 处理后续追问
  return updateFollowUpField(newState, selectedOption);
}

/**
 * 生成问题定义（基于收集的信息）
 */
export function generateProblemDefinition(
  state: QuestionnaireState
): ProblemDefinition {
  return {
    contextSnapshot: state.originalRequirement,
    problemStatement: state.problemDefinition || state.originalRequirement,
    jtbd: state.jtbd || '待定义',
    currentAlternatives: state.alternatives || '待分析',
    evidenceAndAssumptions: state.riskAssumptions || [],
    successCriteria: ['功能完整', '可正常运行'],
    scopeBoundaries: { inScope: [], outOfScope: [] },
    prototypePlan: '待规划'
  };
}

/**
 * 获取带标准线的评分
 * 验收标准：任何评分输出必须包含"达到X分意味着..."描述
 */
export function formatScoreWithStandardLine(
  dimension: string,
  score: number
): string {
  const standards: Record<string, string> = {
    '商业价值': '达到8分意味着：有明确的付费意愿和转化路径，月收入预估可达10万以上',
    '技术可行性': '达到8分意味着：现有技术栈可在2周内完成核心功能，性能达标',
    '用户体验': '达到8分意味着：用户无需学习即可上手，任务完成时间低于行业基准30%',
    '创新程度': '达到8分意味着：颠覆现有解决方案，用户增长可达10倍'
  };

  const standard = standards[dimension] || '达到8分意味着：超出行业平均水平';
  return `${dimension}评分: ${score}/10\n${standard}`;
}

// ============= 私有函数 =============

/**
 * 获取未完成的字段列表
 */
function getIncompleteFields(sixFields: SixFieldProgress): (keyof SixFieldProgress)[] {
  const fields: (keyof SixFieldProgress)[] = [];
  for (const [key, value] of Object.entries(sixFields)) {
    if (value === 'empty' || value === 'in_progress') {
      fields.push(key as keyof SixFieldProgress);
    }
  }
  return fields;
}

/**
 * 根据字段类型构建追问问题
 */
function buildFollowUpQuestion(
  field: keyof SixFieldProgress,
  state: QuestionnaireState
): QuestionnaireResponse {
  const prompts: Record<string, { question: string; options: string[] }> = {
    problemDefinition: {
      question: '您要解决的核心问题是什么？为什么现在必须解决这个问题？',
      options: [
        '提高效率，减少人力成本',
        '开拓新市场，获取新客户',
        '解决用户痛点，提升用户体验',
        '实现自动化，减少人工干预'
      ]
    },
    jtbd: {
      question: '您的目标用户是谁？他们完成什么任务时会使用这个产品？',
      options: [
        '企业内部员工，用于日常工作',
        '普通消费者，用于日常生活',
        '专业人士，用于特定领域',
        '中小企业主，用于经营管理'
      ]
    },
    alternatives: {
      question: '目前您或您的用户是如何解决这个问题的？',
      options: [
        '使用开源工具或免费软件',
        '使用付费的企业级解决方案',
        '手动处理，依赖人工流程',
        '暂时没有解决方案，需求未被满足'
      ]
    },
    riskAssumptions: {
      question: '您认为这个项目最大的不确定性是什么？',
      options: [
        '市场接受度不确定',
        '技术实现难度不确定',
        '成本回收周期不确定',
        '竞争压力不确定'
      ]
    }
  };

  const config = prompts[field] || {
    question: '还有什么需要补充的吗？',
    options: ['是的，有补充', '没有，信息足够']
  };

  return {
    question: config.question,
    options: config.options,
    fieldUpdated: field
  };
}

/**
 * 更新后续字段
 */
function updateFollowUpField(
  state: QuestionnaireState,
  selectedOption: string
): QuestionnaireState {
  const newState = { ...state };
  const currentRound = state.currentRound;

  // 简单地将回答填充到对应字段
  // 这里简化处理，实际可以更智能地分析用户回答
  if (state.sixFields.problemDefinition !== 'completed' && !state.problemDefinition) {
    newState.problemDefinition = selectedOption;
    newState.sixFields = {
      ...state.sixFields,
      problemDefinition: 'completed'
    };
    return newState;
  }

  if (state.sixFields.jtbd !== 'completed' && !state.jtbd) {
    newState.jtbd = selectedOption;
    newState.sixFields = {
      ...state.sixFields,
      jtbd: 'completed'
    };
    return newState;
  }

  if (state.sixFields.alternatives !== 'completed' && !state.alternatives) {
    newState.alternatives = selectedOption;
    newState.sixFields = {
      ...state.sixFields,
      alternatives: 'completed'
    };
    return newState;
  }

  if (state.sixFields.riskAssumptions !== 'completed') {
    const current = state.riskAssumptions || [];
    newState.riskAssumptions = [...current, selectedOption];
    if (current.length >= 2) {
      newState.sixFields = {
        ...state.sixFields,
        riskAssumptions: 'completed'
      };
    }
    return newState;
  }

  // 增加轮次
  newState.currentRound = currentRound + 1;
  return newState;
}

/**
 * 将用户选择映射到创新类型
 */
function mapToInnovationType(selected: string): InnovationType {
  if (selected.includes('颠覆式')) {
    return 'disruptive';
  }
  if (selected.includes('渐进式')) {
    return 'incremental';
  }
  return 'unknown';
}

/**
 * 将用户选择映射到决策卡点类型
 */
function mapToDecisionBlocker(selected: string): DecisionBlockerType {
  if (selected.includes('需求')) {
    return 'requirement';
  }
  if (selected.includes('技术')) {
    return 'technology';
  }
  if (selected.includes('商业') || selected.includes('赚钱')) {
    return 'business';
  }
  if (selected.includes('规模')) {
    return 'scaling';
  }
  return 'unknown';
}

/**
 * 根据决策卡点类型选择对应的追问模板
 * 验收标准：决策卡点定位后，能根据卡点类型选择对应追问模板
 */
export function getBlockerSpecificTemplate(
  blockerType: DecisionBlockerType
): { focus: string; questions: string[] } {
  const templates: Record<DecisionBlockerType, { focus: string; questions: string[] }> = {
    requirement: {
      focus: '需求澄清',
      questions: [
        '目标用户是谁？',
        '核心功能有哪些？',
        '成功标准是什么？'
      ]
    },
    technology: {
      focus: '技术方案探索',
      questions: [
        '技术栈有偏好吗？',
        '性能要求是什么？',
        '有哪些技术约束？'
      ]
    },
    business: {
      focus: '商业模式验证',
      questions: [
        '变现方式是什么？',
        '定价策略是什么？',
        '目标市场规模多大？'
      ]
    },
    scaling: {
      focus: '规模化路径',
      questions: [
        '预计用户量级是多少？',
        '扩展性要求是什么？',
        '有哪些规模化风险？'
      ]
    },
    unknown: {
      focus: '综合探索',
      questions: [
        '您最关心哪个方面？',
        '有什么硬性约束吗？',
        '时间预算是多少？'
      ]
    }
  };

  return templates[blockerType];
}

/**
 * 检查问卷是否完成
 */
export function isQuestionnaireComplete(state: QuestionnaireState): boolean {
  const fields = state.sixFields;
  return (
    fields.innovationType === 'completed' &&
    fields.decisionBlocker === 'completed' &&
    (fields.problemDefinition === 'completed' ||
      fields.jtbd === 'completed' ||
      fields.alternatives === 'completed' ||
      fields.riskAssumptions === 'completed')
  );
}

/**
 * 获取问卷进度摘要
 */
export function getQuestionnaireProgress(state: QuestionnaireState): string {
  const completedFields = Object.values(state.sixFields)
    .filter(v => v === 'completed').length;
  const totalFields = Object.keys(state.sixFields).length;

  const lines = [
    `原始需求: ${state.originalRequirement}`,
    `当前轮次: ${state.currentRound}/${state.maxRounds}`,
    `字段完成度: ${completedFields}/${totalFields}`,
    `创新类型: ${state.innovationTypeAsked ? (state.innovationType || '已选择') : '待选择'}`,
    `决策卡点: ${state.decisionBlockerAsked ? (state.decisionBlocker || '已选择') : '待选择'}`
  ];

  // 高亮显示空白字段（红标）
  for (const [field, status] of Object.entries(state.sixFields)) {
    if (status === 'empty') {
      lines.push(`[高亮] ${field}: ${status} - 需要补充`);
    }
  }

  return lines.join('\n');
}
