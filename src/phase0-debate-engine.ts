/**
 * Phase 0 Debate Engine - 文件共享多 Agent 辩论实现
 *
 * 使用文件共享实现多 Agent 并行辩论：
 * - 每个 Agent 是独立的 Claude CLI 调用
 * - Agent 之间通过读写文件传递信息
 * - 目录结构：round1/ → round2/ → round3/ → synthesis/
 *
 * 核心流程：
 * 1. Coordinator 创建辩论目录
 * 2. 5 个 Agent 并行写 round1/ 文件（独立洞察）
 * 3. 5 个 Agent 并行读 round1/，写 round2/（互相质疑）
 * 4. 5 个 Agent 并行读 round2/，写 round3/（回应质疑）
 * 5. Planner 读 round3/，写 synthesis/（整合收敛）
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { AgentOutput, DebateResult, ProblemDefinition } from './types.js';
import { executeAgent, type AgentEngine } from './utils/agent-executor.js';
import { THREE_RED_LINES } from './pua-constraints.js';

// ============= 常量定义 =============

const DEBATE_DIR = '.phase0-debate';
const ROUND_TIMEOUT = 300000; // 5 分钟每轮（增加超时以适应 claude --print 延迟）

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
 * 5 个视角的中文名称
 */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'phase0-insight-challenger': '需求重构洞察者',
  'phase0-innovation-officer': '颠覆式创新官',
  'phase0-business-operator': '商业闭环操盘手',
  'architect': '工程落地官',
  'planner': '规划收敛者'
};

// ============= 目录结构 =============

interface DebateDirectories {
  base: string;
  round1: string;
  round2: string;
  round3: string;
  synthesis: string;
}

/**
 * 创建辩论目录结构
 */
function createDebateDirectories(baseDir: string, iterationId: number): DebateDirectories {
  const base = join(baseDir, `${DEBATE_DIR}-${iterationId}`);
  const dirs: DebateDirectories = {
    base,
    round1: join(base, 'round1'),
    round2: join(base, 'round2'),
    round3: join(base, 'round3'),
    synthesis: join(base, 'synthesis')
  };

  // 清理已存在的目录
  if (existsSync(base)) {
    rmSync(base, { recursive: true, force: true });
  }

  // 创建所有目录
  mkdirSync(dirs.round1, { recursive: true });
  mkdirSync(dirs.round2, { recursive: true });
  mkdirSync(dirs.round3, { recursive: true });
  mkdirSync(dirs.synthesis, { recursive: true });

  return dirs;
}

// ============= 核心函数 =============

/**
 * 执行完整的 Phase 0 辩论流程
 */
export async function executePhase0Debate(
  baseDir: string,
  problemDefinition: ProblemDefinition,
  iterationId: number
): Promise<DebateResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Phase 0: 产品创新辩论 (迭代 ${iterationId})`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. 创建目录结构
  const dirs = createDebateDirectories(baseDir, iterationId);
  console.log('[Phase 0] 辩论目录:', dirs.base);

  // 2. 市场调研：搜索 GitHub 同类项目
  console.log('[Phase 0] 🔍 市场调研（GitHub 搜索）...');
  try {
    const mr = await searchGitHub(problemDefinition.problemStatement || '');
    if (mr) {
      console.log('[Phase 0] 📊 市场调研完成，注入上下文');
      problemDefinition.contextSnapshot = (problemDefinition.contextSnapshot || '') +
        '\n\n## 🔍 市场调研（GitHub 同类项目搜索）\n' + mr +
        '\n\n⚠️ 请基于以上市场调研来评估创新性。如果我们的方案与这些项目没有本质区别，请明确指出。';
    }
  } catch (e) {
    console.log('[Phase 0] ⚠️ 市场调研跳过（gh CLI 不可用）');
  }

  // 3. 保存问题定义
  const problemFile = join(dirs.base, 'problem-definition.json');
  writeFileSync(problemFile, JSON.stringify(problemDefinition, null, 2), 'utf-8');
  console.log('[Phase 0] 问题定义已保存（含市场调研）');

  try {
    // 4. Round 1: 5 个 Agent 并行独立洞察
    console.log('[Phase 0] Round 1: 5 个 Agent 并行洞察...');
    const round1Outputs = await executeRound1(dirs, problemDefinition);

    // 5. Round 2: 互相质疑
    console.log('[Phase 0] Round 2: 互相质疑...');
    const round2Challenges = await executeRound2(dirs, round1Outputs);

    // 6. Round 3: 回应质疑
    console.log('[Phase 0] Round 3: 回应质疑...');
    const round3Responses = await executeRound3(dirs, round1Outputs, round2Challenges);

    // 7. Planner 整合收敛
    console.log('[Phase 0] Planner 整合收敛...');
    const debateResult = await executeSynthesis(dirs, round1Outputs, round2Challenges, round3Responses);

    console.log(`\n${'='.repeat(60)}`);
    console.log('Phase 0 辩论完成!');
    console.log(`收敛需求: ${debateResult.convergedRequirement.substring(0, 100)}...`);
    console.log(`${'='.repeat(60)}\n`);

    return debateResult;

  } catch (error) {
    console.error('[Phase 0] 执行失败:', error);
    throw error;
  }
}

// ============= Round 1: 并行洞察 =============

/**
 * Round 1: 每个 Agent 独立输出洞察（不看其他 Agent）
 */
async function executeRound1(
  dirs: DebateDirectories,
  problem: ProblemDefinition
): Promise<AgentOutput[]> {
  // 并行执行 5 个 Agent
  const promises = DEBATE_AGENTS.map(agentType => executeAgentRound1(dirs, agentType, problem));
  const results = await Promise.all(promises);
  return results;
}

/**
 * 执行单个 Agent 的 Round 1
 */
async function executeAgentRound1(
  dirs: DebateDirectories,
  agentType: string,
  problem: ProblemDefinition
): Promise<AgentOutput> {
  const outputFile = join(dirs.round1, `${agentType}.md`);
  const displayName = AGENT_DISPLAY_NAMES[agentType];

  console.log(`[Round 1] ${displayName}...`);

  const prompt = buildInsightPrompt(agentType, problem);

  try {
    const output = await execClaudeSDKWithTimeout(prompt, ROUND_TIMEOUT);

    // 解析输出
    const content = extractContent(output);
    writeFileSync(outputFile, content, 'utf-8');

    return { agentName: agentType, content };

  } catch (error) {
    console.error(`[Round 1] ${displayName} 失败:`, error);
    const errorContent = `[Error]: ${error instanceof Error ? error.message : String(error)}`;
    writeFileSync(outputFile, errorContent, 'utf-8');
    return { agentName: agentType, content: errorContent };
  }
}

// ============= Round 2: 互相质疑 =============

/**
 * Round 2: 每个 Agent 读取其他 4 个的输出，提出质疑
 */
async function executeRound2(
  dirs: DebateDirectories,
  round1Outputs: AgentOutput[]
): Promise<Map<string, string>> {
  const promises = DEBATE_AGENTS.map(agentType =>
    executeAgentRound2(dirs, agentType, round1Outputs)
  );
  const results = await Promise.all(promises);

  const challenges = new Map<string, string>();
  results.forEach(({ agentType, challenges: c }) => {
    challenges.set(agentType, c);
  });
  return challenges;
}

/**
 * 执行单个 Agent 的 Round 2
 */
async function executeAgentRound2(
  dirs: DebateDirectories,
  agentType: string,
  allOutputs: AgentOutput[]
): Promise<{ agentType: string; challenges: string }> {
  const outputFile = join(dirs.round2, `${agentType}-challenges.md`);
  const displayName = AGENT_DISPLAY_NAMES[agentType];

  console.log(`[Round 2] ${displayName} 质疑其他视角...`);

  // 获取自己的输出和其他人的输出
  const myOutput = allOutputs.find(o => o.agentName === agentType);
  const otherOutputs = allOutputs.filter(o => o.agentName !== agentType);

  const prompt = buildChallengesPrompt(agentType, myOutput?.content || '', otherOutputs);

  try {
    const output = await execClaudeSDKWithTimeout(prompt, ROUND_TIMEOUT);
    const content = extractContent(output);
    writeFileSync(outputFile, content, 'utf-8');

    return { agentType, challenges: content };

  } catch (error) {
    console.error(`[Round 2] ${displayName} 失败:`, error);
    const errorContent = `[Error]: ${error instanceof Error ? error.message : String(error)}`;
    writeFileSync(outputFile, errorContent, 'utf-8');
    return { agentType, challenges: errorContent };
  }
}

// ============= Round 3: 回应质疑 =============

/**
 * Round 3: 每个 Agent 回应针对自己的质疑
 */
async function executeRound3(
  dirs: DebateDirectories,
  round1Outputs: AgentOutput[],
  challenges: Map<string, string>
): Promise<Map<string, string>> {
  const promises = DEBATE_AGENTS.map(agentType =>
    executeAgentRound3(dirs, agentType, round1Outputs, challenges)
  );
  const results = await Promise.all(promises);

  const responses = new Map<string, string>();
  results.forEach(({ agentType, response }) => {
    responses.set(agentType, response);
  });
  return responses;
}

/**
 * 执行单个 Agent 的 Round 3
 */
async function executeAgentRound3(
  dirs: DebateDirectories,
  agentType: string,
  round1Outputs: AgentOutput[],
  challenges: Map<string, string>
): Promise<{ agentType: string; response: string }> {
  const outputFile = join(dirs.round3, `${agentType}-responses.md`);
  const displayName = AGENT_DISPLAY_NAMES[agentType];

  console.log(`[Round 3] ${displayName} 回应质疑...`);

  const myOutput = round1Outputs.find(o => o.agentName === agentType);
  const myChallenges = challenges.get(agentType) || '';

  const prompt = buildResponsesPrompt(agentType, myOutput?.content || '', myChallenges);

  try {
    const output = await execClaudeSDKWithTimeout(prompt, ROUND_TIMEOUT);
    const content = extractContent(output);
    writeFileSync(outputFile, content, 'utf-8');

    return { agentType, response: content };

  } catch (error) {
    console.error(`[Round 3] ${displayName} 失败:`, error);
    const errorContent = `[Error]: ${error instanceof Error ? error.message : String(error)}`;
    writeFileSync(outputFile, errorContent, 'utf-8');
    return { agentType, response: errorContent };
  }
}

// ============= Synthesis: Planner 整合 =============

/**
 * Planner 整合所有输出，生成收敛需求
 */
async function executeSynthesis(
  dirs: DebateDirectories,
  round1Outputs: AgentOutput[],
  challenges: Map<string, string>,
  responses: Map<string, string>
): Promise<DebateResult> {
  const outputFile = join(dirs.synthesis, 'converged-requirement.md');

  // 构建完整的辩论摘要
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

  const prompt = buildSynthesisPrompt(debateSummary);

  try {
    const output = await execClaudeSDKWithTimeout(prompt, ROUND_TIMEOUT);
    const content = extractContent(output);
    writeFileSync(outputFile, content, 'utf-8');

    // 解析合成结果
    return parseSynthesisResult(content, round1Outputs);

  } catch (error) {
    console.error('[Synthesis] Planner 整合失败:', error);
    return {
      convergedRequirement: `[Error]: ${error instanceof Error ? error.message : String(error)}`,
      acceptanceCriteria: [],
      agentOutputs: round1Outputs,
      commonGround: [],
      keyDisagreements: ['Synthesis failed'],
      finalDecisions: []
    };
  }
}

// ============= Prompt 构建 =============

/**
 * 构建洞察 Prompt
 */
function buildInsightPrompt(agentType: string, problem: ProblemDefinition): string {
  const baseContext = `
# 问题定义

## 上下文快照
${problem.contextSnapshot || ''}

## 问题陈述
${problem.problemStatement || ''}

## JTBD (Jobs to be Done)
${problem.jtbd || ''}

## 当前替代方案
${problem.currentAlternatives || ''}

## 成功标准
${(problem.successCriteria || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## 范围边界
**In Scope:**
${(problem.scopeBoundaries?.inScope || []).map(s => `- ${s}`).join('\n')}

**Out of Scope:**
${(problem.scopeBoundaries?.outOfScope || []).map(s => `- ${s}`).join('\n')}
`;

  const agentPrompts: Record<string, string> = {
    'phase0-insight-challenger': `
你是**需求重构洞察者**，你的任务是**质疑原始需求**，挖掘用户真正要解决的问题。

${baseContext}

## 你的任务
1. 质疑"用户说要X"，找到真正的底层问题
2. 提出至少 3 个对原始需求的质疑
3. 格式：
   ### 质疑 1: [具体质疑]
   ### 质疑 2: [具体质疑]
   ### 质疑 3: [具体质疑]
   ### 最终洞察: [用户真正要解决的问题]
`,

    'phase0-innovation-officer': `
你是**颠覆式创新官**，你的任务是提出**颠覆式创新方向**。你有权力否决不够创新的方案。

${baseContext}

## 你的任务
1. 提出至少 2 个**彻底颠覆**现有方案的创新方向
2. 每个创新方向必须有"wow moment"
3. 用创新审查清单逐项审查每个方向

## 创新审查清单（每个方向必须逐项标注通过/不通过）
- [ ] 是否只是换了皮肤/主题？（是 → 不通过）
- [ ] 核心机制是否和已有产品不同？（否 → 不通过）
- [ ] 用户能否在3分钟内说出"这就像XX"？（能 → 不通过）
- [ ] 是否有用户在现有产品中得不到的体验？（否 → 不通过）

## 格式：
   ### 创新方向 1: [标题]
   - 核心思路: [描述]
   - Wow 点: [什么让人眼前一亮]
   - 跨界借鉴: [从哪个领域借鉴]
   - 创新审查:
     - [x] 非换皮 ✓
     - [x] 核心机制不同于 [列举具体竞品] ✓
     - [x] 用户无法在3分钟内找到同类 ✓
     - [x] 独特体验: [描述]

   ### 创新方向 2: [标题]
   ...

## ⚠️ 如果两个方向都没通过审查，你有权力说"这个需求本身达不到创新标准，建议打回重新定义核心玩法"
`,

    'phase0-business-operator': `
你是**商业闭环操盘手**，你的任务是评估**商业可行性和变现路径**。

${baseContext}

## 你的任务
1. 评估市场规模和潜在收入
2. 识别变现路径
3. 分析竞争壁垒
4. 给出**商业价值分**（1-10）和**落地可行性分**（1-10）
5. 格式：
   ### 市场规模: [描述]
   ### 变现路径: [描述]
   ### 竞争壁垒: [描述]
   ### 商业价值分: X/10
   ### 落地可行性分: X/10
`,

    'architect': `
你是**工程落地官**，你的任务是评估**技术可行性**。

${baseContext}

## 你的任务
1. 评估技术难度（1-10）
2. 识别关键技术挑战
3. 提出技术实现路径
4. 评估开发时间和成本
5. 格式：
   ### 技术难度: X/10
   ### 关键技术挑战:
   - [挑战 1]
   - [挑战 2]
   ### 技术实现路径: [描述]
   ### 预估开发时间: [时间]
`,

    'planner': `
你是**规划收敛者**，你的任务是给出**规划建议**。

${baseContext}

## 你的任务
1. 分析需求的合理性和完整性
2. 提出 Sprint 划分建议
3. 识别潜在风险
4. 格式：
   ### 需求合理性分析: [描述]
   ### Sprint 划分建议:
   - Sprint 1: [内容]
   - Sprint 2: [内容]
   ### 潜在风险:
   - [风险 1]
   - [风险 2]
`
  };

  return agentPrompts[agentType] || `请分析以下问题定义并输出分析结果:\n\n${baseContext}`;
}

/**
 * 构建质疑 Prompt
 */
function buildChallengesPrompt(
  agentType: string,
  myContent: string,
  otherOutputs: AgentOutput[]
): string {
  const otherSummaries = otherOutputs
    .map(a => `## ${AGENT_DISPLAY_NAMES[a.agentName]}\n${a.content.substring(0, 500)}...`)
    .join('\n\n');

  return `
你是**${AGENT_DISPLAY_NAMES[agentType]}**。

## 你的原始洞察
${myContent}

## 其他 4 个视角的洞察
${otherSummaries}

## 你的任务
仔细阅读其他 4 个视角的洞察，对**每一个**提出**至少 1 个具体质疑**。

规则：
- 禁止无理由附和
- 质疑必须具体（不能说"这个方案有问题"，要说清楚什么问题）
- 禁止模棱两可（不能说"可能/也许"）

格式：
## 质疑 [视角名称 1]
[具体质疑内容和原因]

## 质疑 [视角名称 2]
[具体质疑内容和原因]

## 质疑 [视角名称 3]
[具体质疑内容和原因]

## 质疑 [视角名称 4]
[具体质疑内容和原因]
`;
}

/**
 * 构建回应质疑 Prompt
 */
function buildResponsesPrompt(
  agentType: string,
  myContent: string,
  challenges: string
): string {
  return `
你是**${AGENT_DISPLAY_NAMES[agentType]}**。

## 你的原始洞察
${myContent}

## 针对你的质疑
${challenges}

## 你的任务
回应针对你的每一个质疑。规则：
- 对于接受的质疑：承认并修正你的观点
- 对于反驳的质疑：给出具体理由拒绝
- 禁止回避、禁止沉默
- 禁止无理由认错

格式：
## 回应质疑 1
- 原质疑: [内容]
- 我的回应: [接受/反驳/澄清]
- 理由: [具体理由]
- (如果接受) 修正后的观点: [新观点]

## 回应质疑 2
...

## 经过辩论后的最终立场
[综合所有回应后的最终观点]
`;
}

/**
 * 构建整合收敛 Prompt
 */
function buildSynthesisPrompt(debateSummary: string): string {
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

### 风险与注意事项
- [风险 1 及缓解措施]
`;
}

// ============= 辅助函数 =============

/**
 * 解析输出内容
 */
function extractContent(output: string): string {
  const lines = output.trim().split('\n');
  const lastLine = lines[lines.length - 1];

  try {
    const parsed = JSON.parse(lastLine);
    return parsed.content || lastLine;
  } catch {
    return output;
  }
}

/**
 * 解析合成结果
 */
function parseSynthesisResult(content: string, agentOutputs: AgentOutput[]): DebateResult {
  const result: DebateResult = {
    convergedRequirement: '',
    acceptanceCriteria: [],
    agentOutputs,
    commonGround: [],
    keyDisagreements: [],
    finalDecisions: []
  };

  // 简单解析
  const sections = content.split(/^###\s+/m);

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0]?.trim() || '';
    const body = lines.slice(1).join('\n').trim();

    if (title.includes('共识') || title.includes('收敛需求')) {
      const items = body.match(/^\d+\.\s+(.+)$/gm) || [];
      if (items.length > 0) {
        result.acceptanceCriteria = items.map(item => item.replace(/^\d+\.\s+/, ''));
      }
      if (!result.convergedRequirement && body.length > 50) {
        result.convergedRequirement = body.substring(0, 500);
      }
    }
  }

  if (!result.convergedRequirement) {
    result.convergedRequirement = content.substring(0, 1000);
  }

  return result;
}

// ============= 工具函数 =============

/**
 * 为每个辩论 Agent 构建专属 System Prompt
 * 不再共用通用的"专业的 AI 助手"，每个角色有独特的定位和约束
 */
function getDebateAgentSystemPrompt(agentType: string): string {
  const baseConstraints = THREE_RED_LINES;

  const rolePrompts: Record<string, string> = {
    'phase0-insight-challenger': `你是**需求重构洞察者**——你的核心能力是看穿表面需求，挖掘真正的底层问题。你有权对任何"不够独特"的方案提出根本性质疑。

## 你的信条
1. 用户说的不一定是真正需要的——你的任务是找出真正的 JTBD
2. 每个质疑必须指向具体的逻辑漏洞或未验证的假设
3. 好的质疑比好的方案更有价值
4. 必须追问：市面上的产品为什么没有满足用户？我们的方案凭什么不同？

## 市场感知
你会收到一份市场调研结果。请仔细阅读，并：
- 指出现有产品的共同模式（如果我们的方案也在重复这些模式，必须指出）
- 找出竞品没有覆盖的空白地带
- 质疑我们是否只是在"换皮肤"

## 禁止
- 禁止附和原始需求（你不是来点赞的）
- 禁止说"这个需求很好"而不给质疑
- 禁止模糊质疑（必须指出具体哪里有问题）
- 禁止忽略市场调研结果

${baseConstraints}`,

    'phase0-innovation-officer': `你是**颠覆式创新官**——你的核心能力是从其他领域借鉴思路，提出用户想不到的方案。你拥有对平庸方案的绝对否决权。

## 你的信条
1. 好的创新来自跨界——从游戏/金融/社交/教育等领域借鉴
2. 每个创新方向必须说清楚"wow moment"在哪里
3. 创新不等于天马行空——必须说明借鉴的源头
4. 你有权力说"这个方案不够创新，和市面上的X、Y没有本质区别"

## 创新审查清单（每个方向必须通过）
- [ ] 如果只换了一个主题/皮肤，不算创新
- [ ] 如果核心机制和已有产品相同，不算创新
- [ ] 如果用户玩了3分钟就能说出"这就像XX游戏"，不算创新
- [ ] 必须有至少一个用户在现有产品中得不到的体验

## 禁止
- 禁止提"用AI优化"这种没有具体方案的创新
- 禁止不提跨界来源的凭空创新
- 禁止接受"核心机制不可颠覆"——如果只能做已有产品，这个项目就不该做

${baseConstraints}`,

    'phase0-business-operator': `你是**商业闭环操盘手**——你的核心能力是评估一个想法的商业价值，并找到最短的变现路径。

## 你的信条
1. 好产品不等于好生意——你必须独立判断商业可行性
2. 每个数字都要有来源（即使是估算，也要标注[估算]并说明估算依据）
3. 市场规模、变现路径、竞争壁垒三者缺一不可

## 禁止
- 禁止不标注数据来源的数字（凭空编造=失职）
- 禁止只说"市场很大"而不给具体数据

${baseConstraints}`,

    'architect': `你是**工程落地官**——你的核心能力是评估技术可行性，判断一个想法能不能做、要花多少成本。

## 你的信条
1. 技术上不可行的方案 = 纸上谈兵
2. 每个技术判断必须有依据（同类项目经验/技术文档/开源方案）
3. 开发时间估算要标注不确定性范围（如 2-4周）

## 禁止
- 禁止说"技术可以实现"而不提具体怎么实现
- 禁止忽略技术债务和长期维护成本

${baseConstraints}`,

    'planner': `你是**规划收敛者**——你的核心能力是综合多方观点，做出最终决策并输出可执行计划。

## 你的信条
1. 你不是独裁者——你的裁决必须基于各方观点的优劣，而非个人偏好
2. 每个裁决必须附上理由（为什么选A不选B）
3. 最终输出必须可执行（模糊的结论=失败的收敛）

## 禁止
- 禁止模棱两可的裁决（必须明确站队）
- 禁止忽略任何一方的核心论据

${baseConstraints}`,
  };

  return rolePrompts[agentType] || `你是一个需求分析专家。${baseConstraints}`;
}

/**
 * 使用 Anthropic SDK 执行消息（带超时）- 使用健壮的执行器
 */
async function execClaudeSDKWithTimeout(
  prompt: string,
  timeout: number,
  systemPrompt?: string,
  engine: AgentEngine = 'minimax'
): Promise<string> {
  const effectiveSystemPrompt = systemPrompt || '你是一个需求分析专家。请给出简洁、有洞察力的回答。';

  const result = await executeAgent(
    effectiveSystemPrompt,
    prompt,
    {
      engine,
      timeout,
      // 辩论输出通过 MiniMax 直连执行，内置重试由 agent-executor 处理
    }
  );

  if (!result.success) {
    throw new Error(`辩论Agent执行失败: ${result.error || '未知错误'}`);
  }

  return result.output;
}
/**
 * 搜索 GitHub 同类项目（使用 gh CLI）
 */
async function searchGitHub(requirement: string): Promise<string> {
  const words = requirement.slice(0, 100)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 5);
  const query = words.join(' ') || 'game';

  try {
    const { execCommand: ec } = await import('./utils/agent-executor.js');
    const result = await ec('gh', [
      'search', 'repos', query,
      '--sort', 'stars', '--limit', '5',
      '--json', 'fullName,stargazersCount,description'
    ], { timeout: 15000 });

    if (result.success && result.stdout) {
      const data = JSON.parse(result.stdout);
      return data.map((r: any) =>
        '- ' + r.fullName + ' ⭐' + r.stargazersCount + ': ' +
        (r.description || '(no description)').slice(0, 100)
      ).join('\n');
    }
  } catch { /* gh not available */ }

  // Fallback: try curl to GitHub API
  try {
    const { execCommand: ec } = await import('./utils/agent-executor.js');
    const result = await ec('curl', [
      '-s', '-H', 'Accept: application/vnd.github.v3+json',
      'https://api.github.com/search/repositories?q=' +
      encodeURIComponent(query) + '&sort=stars&per_page=5'
    ], { timeout: 10000 });

    if (result.success && result.stdout) {
      const data = JSON.parse(result.stdout);
      return (data.items || []).map((r: any) =>
        '- ' + r.full_name + ' ⭐' + r.stargazers_count + ': ' +
        (r.description || '(no description)').slice(0, 100)
      ).join('\n');
    }
  } catch { /* curl not available */ }

  return '';
}



/**
 * 执行 Claude Code CLI 命令（带超时）- 仅作为备用
 */
async function execClaudeCodeWithTimeout(args: string[], timeout: number): Promise<string> {
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

/**
 * 清理辩论目录
 */
export function cleanupDebateDir(baseDir: string, iterationId: number): void {
  const dir = join(baseDir, `${DEBATE_DIR}-${iterationId}`);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
