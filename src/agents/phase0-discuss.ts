/**
 * Phase 0: 需求拷问 Agent
 * 
 * 独立于自动化流水线。用户交互式工具。
 * 
 * 流程:
 *   1. 市场调研 (GitHub + 网络)
 *   2. 假设显式化
 *   3. 多方案 + 权衡
 *   4. 范围建议
 *   5. 开放问题
 *   6. 输出 REQUIREMENT.md
 * 
 * 用户审查 REQUIREMENT.md 后 → npm run v3
 */

import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES } from '../constraints/pua.js';
import type { AgentEngine } from '../utils/agent-executor.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DISCUSS_PROMPT = `你是资深产品战略顾问。你的任务是把模糊想法变成可执行的完整需求。

## 工作流程

### 1. 市场调研
搜索 GitHub、网络上的同类产品。找到至少 3 个竞品/参考项目。
对每个: 名称、stars、核心差异点、我们可借鉴的地方。

### 2. 创新审查
这个想法与市面上的产品有什么不同？如果没有差异，指出并建议差异化方向。

### 3. 假设显式化
列出你对这个产品的所有假设（目标用户、技术栈、商业模式、部署方式…）
用户可能在后续纠正。

### 4. 多方案对比 (≥2个)
| 方案 | 描述 | 优点 | 缺点 | 工期估算 |
每个方案一句话总结。
推荐一个方案并说明理由。

### 5. 范围建议
- MVP 必须包含: (≤5项)
- 可以后续再加: (≤3项)
- 明确不做的: (≤2项)

### 6. 开放问题 (留给用户回答)
至少 3 个需要用户决策的问题。用选择题格式。

## 输出格式

输出完整的 REQUIREMENT.md:
\`\`\`markdown
# 需求文档: [项目名]

> 生成时间: [时间]
> 原始需求: "[用户输入]"

## 1. 市场调研
[竞品分析]

## 2. 创新审查
[差异化分析]

## 3. 假设
[列出所有假设]

## 4. 方案对比
[表格 + 推荐]

## 5. 范围
- MVP: [...]
- 后续: [...]
- 不做: [...]

## 6. 开放问题
[至少3个选择题]

## 7. 成功标准
[可量化的指标]
\`\`\`

## 原则
- 每个结论附依据（URL、数据、代码引用）
- 禁止 "可能是"、"应该是" 等猜测
- 如果市场搜索失败，诚实说明并基于已有知识推断

${THREE_RED_LINES}`;

// ═══════════ 市场调研 ═══════════

async function marketResearch(requirement: string): Promise<string> {
  const results: string[] = [];

  // GitHub 搜索
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
  } catch {
    results.push('（GitHub 搜索不可用）');
  }

  // HackerNews 搜索 (不需要 API key)
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
  } catch {
    // HN not available, skip
  }

  return results.join('\n') || '（市场搜索暂不可用，基于已有知识推断）';
}

// ═══════════ 核心 =========== ═

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
  console.log('\n🧠 Phase 0: 需求拷问');
  console.log(`原始需求: "${requirement}"`);
  console.log('='.repeat(60));

  // 1. 市场调研
  console.log('\n🔍 [1/3] 市场调研...');
  const market = await marketResearch(requirement);
  console.log(market.slice(0, 300) + (market.length > 300 ? '...' : ''));

  // 2. LLM 深度分析
  console.log('\n📋 [2/3] 需求分析 (假设+方案+范围)...');
  const prompt = `# 用户原始需求
"${requirement}"

${market}

请按 6 步流程输出完整的 REQUIREMENT.md。`;

  let analysis: string;
  try {
    analysis = await agentCall(DISCUSS_PROMPT, prompt, engine);
  } catch (err) {
    console.error('Phase 0 LLM 调用失败:', err);
    return { success: false, outputPath: '', summary: 'LLM 调用失败' };
  }

  // 3. 提取并写入 REQUIREMENT.md
  console.log('\n📝 [3/3] 输出 REQUIREMENT.md...');
  const mdMatch = analysis.match(/```markdown\s*([\s\S]*?)```/) || 
                  analysis.match(/# 需求文档[\s\S]*?(?=```|$)/);
  
  const content = mdMatch 
    ? mdMatch[1] || mdMatch[0]
    : analysis;

  const tasksDir = join(projectDir, '.tasks');
  mkdirSync(tasksDir, { recursive: true });
  const outputPath = join(tasksDir, 'REQUIREMENT.md');
  
  const fullDoc = `# 需求文档\n\n> 原始需求: "${requirement}"\n> 生成时间: ${new Date().toISOString()}\n\n---\n\n${content}`;
  writeFileSync(outputPath, fullDoc, 'utf-8');

  // 提取摘要
  const scopeMatch = fullDoc.match(/MVP[^:]*:?\s*([\s\S]*?)(?=## |$)/i);
  const questionsMatch = fullDoc.match(/开放问题[\s\S]*?(?=## |$)/i);
  
  const summary = [
    'Phase 0 完成。',
    '',
    '📄 ' + outputPath,
    scopeMatch ? '\n范围:\n' + scopeMatch[1].trim().slice(0, 200) : '',
    questionsMatch ? '\n待决策:\n' + questionsMatch[0].trim().slice(0, 300) : '',
  ].join('\n');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Phase 0 完成');
  console.log(summary);
  console.log('\n审查 REQUIREMENT.md 后运行: npm run v3');

  return { success: true, outputPath, summary };
}
