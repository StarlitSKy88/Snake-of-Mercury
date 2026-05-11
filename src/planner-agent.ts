/**
 * Planner Agent — Anthropic Harness 三角之一
 * 
 * 职责：将 Phase 0 辩论输出扩展为完整产品规格
 * 
 * 设计原则：
 * - 输入：Phase 0 收敛后的需求（1-4句）+ 辩论结果
 * - 输出：15+功能的产品规格 + Sprint 分解
 * - 保持对产品上下文和高层技术设计的关注，不过度指定技术实现细节
 * - 主动寻找机会将 AI 功能编织进产品规格
 */

import { executeAgent, type AgentEngine } from './utils/agent-executor.js';
import type { ProductSpec, SprintContract, DebateResult } from './types.js';

// ============= 类型 =============

export interface PlannerInput {
  /** 原始用户需求 */
  originalRequirement: string;
  /** Phase 0 辩论结果 */
  debateResult?: DebateResult;
  /** 项目目录 */
  projectDir: string;
}

export interface PlannerOutput {
  spec: ProductSpec;
  /** 生成的原始文本 */
  rawOutput: string;
  /** 是否成功生成 */
  success: boolean;
}

// ============= 核心 =============

/**
 * 执行 Planner — 将模糊需求扩展为完整产品规格
 */
export async function executePlanner(
  input: PlannerInput,
  engine: AgentEngine = 'claude'
): Promise<PlannerOutput> {
  console.log('\n📋 [Planner] 生成产品规格...\n');

  const convergedRequirement = input.debateResult?.convergedRequirement || input.originalRequirement;

  const plannerPrompt = buildPlannerPrompt(convergedRequirement, input.debateResult);

  try {
    const result = await executeAgent(
      PLANNER_SYSTEM_PROMPT,
      plannerPrompt,
      { engine, workdir: input.projectDir, timeout: 300000 }
    );

    if (!result.success) {
      console.error('[Planner] 执行失败:', result.error);
      return { spec: createFallbackSpec(input.originalRequirement), rawOutput: '', success: false };
    }

    // 解析 JSON 输出
    const spec = parseSpecFromOutput(result.output, input.originalRequirement);

    // 验证 Sprint 规划
    if (!spec.sprintPlan || spec.sprintPlan.length < 3) {
      console.warn('[Planner] Sprint 不足，补充默认 Sprint');
      spec.sprintPlan = ensureMinimumSprints(spec.sprintPlan || []);
    }

    console.log(`[Planner] ✅ 完成: ${spec.featureList.must.length} 个必须功能, ${spec.sprintPlan.length} 个 Sprint`);
    return { spec, rawOutput: result.output, success: true };

  } catch (error) {
    console.error('[Planner] 异常:', error);
    return { spec: createFallbackSpec(input.originalRequirement), rawOutput: '', success: false };
  }
}

// ============= Prompt 构建 =============

const PLANNER_SYSTEM_PROMPT = `You are a world-class product planner and technical architect.

Your job: take a converged product requirement and produce a comprehensive, ambitious product specification.

## Principles
1. Be AMBITIOUS about scope — think big, then break it down
2. Stay focused on PRODUCT context and HIGH-LEVEL technical design
3. Do NOT over-specify granular technical implementation details
4. Look for opportunities to weave AI features into the product
5. Each feature must be independently testable and deliverable

## Output Format
You MUST output valid JSON with this exact structure:

{
  "overview": "Product overview paragraph",
  "featureList": {
    "must": ["feature 1", "feature 2", ...],
    "should": ["feature 1", ...],
    "could": ["feature 1", ...]
  },
  "sprintPlan": [
    {
      "sprintNumber": 1,
      "objectives": ["objective 1"],
      "acceptanceCriteria": ["criteria 1"],
      "estimatedDuration": "1-2 hours",
      "technicalConstraints": []
    }
  ],
  "technicalDirection": "Tech stack and architecture overview",
  "acceptanceStandards": ["standard 1", "standard 2"]
}

## Sprint Rules
- Generate 5-8 sprints minimum
- Sprint 1: Core infrastructure + project setup
- Sprint 2-3: Core features (MUST)
- Sprint 4-5: Extended features (SHOULD)  
- Sprint 6-7: Polish features (COULD)
- Final Sprint: Testing, documentation, deployment config
- Each sprint must produce WORKING, TESTABLE output`;

/**
 * 构建 Planner 提示词
 */
function buildPlannerPrompt(requirement: string, debateResult?: DebateResult): string {
  let prompt = `# Product Planning Task

## Converged Requirement
${requirement}
`;

  if (debateResult?.finalDecisions?.length) {
    prompt += `\n## Key Decisions from Debate\n${debateResult.finalDecisions.map(d => `- ${d}`).join('\n')}\n`;
  }

  if (debateResult?.commonGround?.length) {
    prompt += `\n## Consensus Points\n${debateResult.commonGround.map(g => `- ${g}`).join('\n')}\n`;
  }

  prompt += `
## Your Task
Generate a comprehensive product specification. Be ambitious.

## Reminders
- Include 5-8 meaningful sprints
- Each sprint must have clear, testable acceptance criteria
- Look for AI feature opportunities
- Output ONLY the JSON, no markdown wrapper`;

  return prompt;
}

// ============= JSON 解析 =============

/**
 * 从 LLM 输出中解析 ProductSpec
 * 处理 markdown 代码块包裹的 JSON
 */
function parseSpecFromOutput(output: string, fallbackRequirement: string): ProductSpec {
  // 尝试多种解析策略
  const strategies = [
    () => JSON.parse(output),                          // 纯 JSON
    () => JSON.parse(extractJSONBlock(output)),        // markdown 代码块
    () => JSON.parse(extractBracedJSON(output)),       // 从文本中提取 {...}
  ];

  for (const strategy of strategies) {
    try {
      const parsed = strategy();
      if (parsed?.featureList?.must?.length > 0) {
        return normalizeSpec(parsed);
      }
    } catch { /* continue */ }
  }

  // 所有策略失败，返回 fallback
  console.warn('[Planner] 无法解析输出，使用 fallback');
  return createFallbackSpec(fallbackRequirement);
}

function extractJSONBlock(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return match ? match[1].trim() : text;
}

function extractBracedJSON(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

// ============= 规格标准化 =============

function normalizeSpec(raw: Record<string, unknown>): ProductSpec {
  return {
    overview: String(raw.overview || ''),
    featureList: {
      must: ensureArray((raw?.featureList as Record<string,unknown>)?.must),
      should: ensureArray((raw?.featureList as Record<string,unknown>)?.should),
      could: ensureArray((raw?.featureList as Record<string,unknown>)?.could),
    },
    sprintPlan: ensureSprintPlan(raw.sprintPlan),
    technicalDirection: String(raw.technicalDirection || ''),
    acceptanceStandards: ensureArray(raw.acceptanceStandards),
  };
}

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function ensureSprintPlan(raw: unknown): SprintContract[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return createDefaultSprints();
  }
  return raw.map((s: Record<string, unknown>, i: number) => ({
    sprintNumber: Number(s.sprintNumber) || i + 1,
    objectives: ensureArray(s.objectives),
    acceptanceCriteria: ensureArray(s.acceptanceCriteria),
    estimatedDuration: String(s.estimatedDuration || '1-2小时'),
    technicalConstraints: ensureArray(s.technicalConstraints),
  }));
}

function ensureMinimumSprints(sprints: SprintContract[]): SprintContract[] {
  const defaults = createDefaultSprints();
  if (sprints.length >= 3) return sprints;
  // 补充缺少的 sprint
  const maxNum = sprints.reduce((max, s) => Math.max(max, s.sprintNumber), 0);
  for (let i = sprints.length; i < 3; i++) {
    sprints.push({ ...defaults[i], sprintNumber: maxNum + i - sprints.length + 2 });
  }
  return sprints;
}

// ============= Fallback =============

function createFallbackSpec(requirement: string): ProductSpec {
  return {
    overview: requirement,
    featureList: { must: [requirement], should: [], could: [] },
    sprintPlan: createDefaultSprints(),
    technicalDirection: 'TypeScript + Vitest',
    acceptanceStandards: ['功能可运行', '测试通过'],
  };
}

function createDefaultSprints(): SprintContract[] {
  return [
    { sprintNumber: 1, objectives: ['项目初始化 + 核心基础设施'], acceptanceCriteria: ['项目可构建', '基础设施就绪'], estimatedDuration: '1-2小时', technicalConstraints: [] },
    { sprintNumber: 2, objectives: ['核心功能实现 (MUST)'], acceptanceCriteria: ['核心功能可运行'], estimatedDuration: '2-3小时', technicalConstraints: [] },
    { sprintNumber: 3, objectives: ['扩展功能实现 (SHOULD)'], acceptanceCriteria: ['扩展功能可运行'], estimatedDuration: '2-3小时', technicalConstraints: [] },
    { sprintNumber: 4, objectives: ['测试完善 + 文档 + 发布'], acceptanceCriteria: ['测试覆盖率≥70%', '文档完整'], estimatedDuration: '1-2小时', technicalConstraints: [] },
  ];
}
