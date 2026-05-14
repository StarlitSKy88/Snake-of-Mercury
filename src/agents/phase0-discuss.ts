/**
 * Phase 0: 需求拷问 Agent
 * 
 * v5 P1-6: 借鉴 TradingAgents Bull/Bear 辩论模式
 *   正反方强制对抗 → 破解确认偏误
 * 
 * 流程:
 *   1. 市场调研 (GitHub + HN)
 *   2. LLM 深度分析 (假设+方案+范围)
 *   3. 正反方辩论 (Proposer ⇄ Challenger, 2轮)
 *   4. 输出 REQUIREMENT.md (含辩论摘要)
 */

import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES } from '../constraints/pua.js';
import type { AgentEngine } from '../utils/agent-executor.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ═══════════ System Prompts ═══════════

const DISCUSS_PROMPT = `你是资深产品战略顾问。你的任务是把模糊想法变成可执行的完整需求。

## 工作流程

### 1. 市场调研
搜索 GitHub、网络上的同类产品。找到至少 3 个竞品/参考项目。
对每个: 名称、stars、核心差异点、我们可借鉴的地方。

### 2. 创新审查
这个想法与市面上的产品有什么不同？如果没有差异，指出并建议差异化方向。

### 3. 假设显式化
列出你对这个产品的所有假设（目标用户、技术栈、商业模式、部署方式…）

### 4. 多方案对比 (≥2个)
| 方案 | 描述 | 优点 | 缺点 | 工期估算 |
每个方案一句话总结。推荐一个方案并说明理由。

### 5. 范围建议
- MVP 必须包含: (≤5项)
- 可以后续再加: (≤3项)
- 明确不做的: (≤2项)

### 6. 开放问题 (留给用户回答)
至少 3 个需要用户决策的问题。用选择题格式。

## 输出格式
输出完整的分析文档 (markdown)。

## 原则
- 每个结论附依据（URL、数据、代码引用）
- 禁止 "可能是"、"应该是" 等猜测
- 如果市场搜索失败，诚实说明并基于已有知识推断

${THREE_RED_LINES}`;

/** P1-6: Proposer——为推荐方案辩护 */
const PROPOSER_PROMPT = `你是方案推荐者 (Proposer)。你的任务是为你推荐的方案做最强辩护。

## 规则
1. 直接回应 Challenger 的每个质疑点
2. 用具体数据、案例、逻辑链反驳
3. 承认对方有道理的地方，但解释为什么你的方案仍然最优
4. 不要只是重复之前的观点——引入新证据
5. 如果 Challenger 指出了一个你无法反驳的漏洞，诚实承认并修正方案

## 输出格式
\`\`\`
## Proposer 回应

### 对质疑 1 的回应: [Challenger 的具体质疑]
[数据/案例/逻辑反驳]

### 对质疑 2 的回应: [Challenger 的具体质疑]
[数据/案例/逻辑反驳]

### 维护的核心观点
[你的方案为什么仍然是最优选择]

### 修正/让步 (如有)
[Challenger 说服你的地方，和你的方案修正]
\`\`\``;

/** P1-6: Challenger——质疑推荐方案 */
const CHALLENGER_PROMPT = `你是方案质疑者 (Challenger)。你的任务是找出推荐方案的漏洞、风险和更好的替代方案。

## 规则
1. 直接回应 Proposer 的每个观点，用数据或逻辑反驳
2. 关注: 市场风险、技术可行性、成本估算偏差、竞品威胁
3. 从至少 3 个角度质疑: 用户角度、技术角度、商业角度
4. 不要为质疑而质疑——每次质疑要有具体依据
5. 可以提出更好的替代方案

## 输出格式
\`\`\`
## Challenger 质疑

### 质疑 1: [具体观点]
[为什么这个观点可能有问题 / 数据 / 逻辑]
[建议: 替代方案或修正]

### 质疑 2: [具体观点]
[为什么这个观点可能有问题 / 数据 / 逻辑]
[建议: 替代方案或修正]

### 质疑 3 (可选): [具体观点]
[为什么这个观点可能有问题 / 数据 / 逻辑]
[建议: 替代方案或修正]

### 最严重的风险
[如果不解决，会导致项目失败的前1-2个风险]
\`\`\``;

// ═══════════ 市场调研 ═══════════

async function marketResearch(requirement: string): Promise<string> {
  const results: string[] = [];

  try {
    const { execCommand } = await import('../utils/agent-executor.js');
    const keywords = requirement.slice(0, 80).replace(/[^a-zA-Z0-9\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/).slice(0, 4).join(' ');
    
    const ghResult = await execCommand('gh', [
      'search', 'repos', keywords,
      '--sort', 'stars', '--limit', '5',
      '--json', 'fullName,description,stargazersCount,url'
    ], { timeout: 15000 });

    if (ghResult.success && ghResult.stdout) {
      const repos = JSON.parse(ghResult.stdout);
      if (repos.length > 0) {
        results.push('## GitHub 同类项目\n');
        results.push('| 项目 | Stars | 描述 |');
        results.push('|------|-------|------|');
        for (const r of repos) {
          results.push(`| [${r.fullName}](${r.url}) | ⭐${r.stargazersCount} | ${(r.description || '').slice(0, 100)} |`);
        }
      }
    }
  } catch { results.push('（GitHub 搜索不可用）'); }

  try {
    const hnRes = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(requirement.slice(0, 50))}&hitsPerPage=3`
    );
    if (hnRes.ok) {
      const hn = await hnRes.json() as any;
      if (hn.hits?.length > 0) {
        results.push('\n## HackerNews 相关讨论\n');
        for (const h of hn.hits.slice(0, 3)) {
          results.push(`- [${h.title}](${h.url || `https://news.ycombinator.com/item?id=${h.objectID}`}) — ${h.points} points, ${h.num_comments} comments`);
        }
      }
    }
  } catch { /* HN not available */ }

  return results.join('\n') || '（市场搜索暂不可用，基于已有知识推断）';
}

// ═══════════ P1-6: 正反方辩论 ═══════════

async function runDebate(
  analysis: string,
  requirement: string,
  engine: AgentEngine,
  rounds: number = 2
): Promise<{ history: string; summary: string }> {
  console.log(`\n⚔️  [辩论] 正反方对抗 (${rounds}轮)...`);
  
  let debateHistory = '';
  let proposedPlan = extractProposedPlan(analysis);
  let challengerLast = '';

  for (let r = 1; r <= rounds; r++) {
    // Proposer 回合 (第一轮用分析中的推荐方案，后续轮回应 challenger)
    const proposerInput = r === 1
      ? `## 推荐方案\n${proposedPlan}\n\n## 当前分析\n${analysis.slice(0, 2000)}`
      : `## Challenger 上一轮质疑\n${challengerLast}\n\n## 你的推荐方案\n${proposedPlan}`;

    console.log(`  ⚔️  第${r}轮: Proposer →`);
    const proposerResp = await agentCall(PROPOSER_PROMPT, proposerInput, engine);
    debateHistory += `\n\n### 第${r}轮 — Proposer\n${proposerResp}`;

    // Challenger 回合
    const challengerInput = `## 原始需求\n"${requirement}"\n\n## 分析\n${analysis.slice(0, 1000)}\n\n## Proposer 上一轮\n${proposerResp.slice(0, 2000)}`;

    console.log(`  ⚔️  第${r}轮: Challenger →`);
    const challengerResp = await agentCall(CHALLENGER_PROMPT, challengerInput, engine);
    debateHistory += `\n\n### 第${r}轮 — Challenger\n${challengerResp}`;
    challengerLast = challengerResp;

    // 如果 Challenger 没有实质性质疑，提前结束
    if (r < rounds && !hasSubstantiveCritique(challengerResp)) {
      console.log('  ℹ️  Challenger 未提出实质性质疑，辩论提前结束');
      break;
    }
  }

  // 生成辩论摘要
  const summary = generateDebateSummary(debateHistory);
  
  return { history: debateHistory, summary };
}

/** 从分析中提取推荐方案 */
function extractProposedPlan(analysis: string): string {
  const match = analysis.match(/推荐[方案方].*?[:：]\s*(.*?)(?=\n\n|\n##|$)/is)
    || analysis.match(/方案对比[\s\S]*?推荐[:：]?\s*(.*?)(?=\n##|$)/i)
    || analysis.match(/(?:推荐|建议).*?[:：]\s*(.*?)(?=\n\n|\n##|$)/i);
  return match ? match[1].trim() : analysis.slice(0, 500);
}

/** 检测 Challenger 是否有实质性质疑 */
function hasSubstantiveCritique(response: string): boolean {
  const critiquePatterns = [
    /质疑\s*\d/i,
    /风险/i,
    /漏洞/i,
    /问题/i,
    /不可行/i,
    /替代方案/i,
    /不应该/i,
    /建议.*改/i,
    /question|risk|flaw|issue|concern|alternative/i,
  ];
  return critiquePatterns.some(p => p.test(response));
}

/** 生成辩论摘要 */
function generateDebateSummary(history: string): string {
  // 提取共识点和分歧点
  const agreements = history.match(/(?:承认|同意|共识|Agree|consensus)[^。\n]{10,100}/gi) || [];
  const disagreements = history.match(/(?:质疑|风险|漏洞|不可行|disagree|risk|flaw)[^。\n]{10,100}/gi) || [];

  return [
    '## 辩论摘要',
    '',
    `**辩论轮数**: 检测到 ${history.match(/第\d轮/g)?.length || 0} 次发言`,
    '',
    '**共识点**:',
    ...agreements.slice(0, 3).map(a => `- ${a.trim()}`),
    agreements.length === 0 ? '- (未检测到明确共识)' : '',
    '',
    '**分歧点 / 风险**:',
    ...disagreements.slice(0, 5).map(d => `- ${d.trim()}`),
    disagreements.length === 0 ? '- (未检测到明确分歧)' : '',
    '',
    '**建议**: 在继续开发前，请用户确认分歧点中的决策方向。',
  ].join('\n');
}

// ═══════════ 核心 ═══════════

export interface DiscussResult {
  success: boolean;
  outputPath: string;
  summary: string;
}

export async function discuss(
  requirement: string,
  projectDir: string,
  engine: AgentEngine = 'minimax'
): Promise<DiscussResult> {
  console.log('\n🧠 Phase 0: 需求拷问 (v5 辩论增强)');
  console.log(`原始需求: "${requirement}"`);
  console.log('='.repeat(60));

  // 1. 市场调研
  console.log('\n🔍 [1/4] 市场调研...');
  const market = await marketResearch(requirement);
  console.log(market.slice(0, 300) + (market.length > 300 ? '...' : ''));

  // 2. LLM 深度分析
  console.log('\n📋 [2/4] 需求分析 (假设+方案+范围)...');
  const prompt = `# 用户原始需求
"${requirement}"

${market}

请按6步流程输出完整分析。`;
  let analysis: string;
  try {
    analysis = await agentCall(DISCUSS_PROMPT, prompt, engine);
  } catch (err) {
    console.error('Phase 0 LLM 调用失败:', err);
    return { success: false, outputPath: '', summary: 'LLM 调用失败' };
  }

  // 3. P1-6: 正反方辩论
  console.log('\n⚔️  [3/4] 正反方辩论...');
  const debate = await runDebate(analysis, requirement, engine, 2);

  // 4. 输出 REQUIREMENT.md (含辩论)
  console.log('\n📝 [4/4] 输出 REQUIREMENT.md...');
  const mdMatch = analysis.match(/```markdown\s*([\s\S]*?)```/) || 
                  analysis.match(/# 需求文档[\s\S]*?(?=```|$)/);
  
  const content = mdMatch ? (mdMatch[1] || mdMatch[0]) : analysis;

  const tasksDir = join(projectDir, '.tasks');
  mkdirSync(tasksDir, { recursive: true });
  const outputPath = join(tasksDir, 'REQUIREMENT.md');
  
  const fullDoc = [
    '# 需求文档',
    '',
    `> 原始需求: "${requirement}"`,
    `> 生成时间: ${new Date().toISOString()}`,
    `> 辩论增强: v5 P1-6 (借鉴 TradingAgents Bull/Bear 对抗模式)`,
    '',
    '---',
    '',
    content,
    '',
    '---',
    '',
    '## 辩论记录',
    '',
    debate.history,
    '',
    debate.summary,
  ].join('\n');

  writeFileSync(outputPath, fullDoc, 'utf-8');

  const summary = [
    'Phase 0 完成 (辩论增强)。',
    '',
    '📄 ' + outputPath,
    debate.summary.split('\n').slice(0, 8).join('\n'),
  ].join('\n');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Phase 0 完成');
  console.log(summary);
  console.log('\n审查 REQUIREMENT.md 后运行: npm run v3');

  return { success: true, outputPath, summary };
}
