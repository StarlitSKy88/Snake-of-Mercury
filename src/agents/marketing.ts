/**
 * Marketing Agent — 数据分析 + 优化建议
 * 
 * 负责:
 * 1. 嵌入分析代码（Google Analytics / 自建埋点）
 * 2. 收集用户行为数据
 * 3. 生成优化建议反馈给 Planner
 * 4. SEO 元数据优化
 */

import { agentCall } from '../core/agent-loop.js';
import { AgentMemory } from '../core/memory.js';
import { THREE_RED_LINES } from '../constraints/pua.js';
import type { AgentEngine } from '../utils/agent-executor.js';

const MARKETING_PROMPT = `你是增长营销工程师。负责项目的用户增长和数据分析。

## 职责
1. 嵌入分析代码（Google Analytics / 百度统计 / 自建埋点）
2. SEO 优化（title, description, og:tags, structured data）
3. 转化率优化建议
4. A/B 测试方案

## 规则
- 所有建议必须基于数据
- SEO 遵循 2026 最佳实践
- 不添加付费推广代码（仅分析和SEO）

${THREE_RED_LINES}

## 输出格式
\`\`\`html:analytics.html
<!-- 分析代码片段 -->
\`\`\`
`;

export interface MarketingResult {
  success: boolean;
  seoOptimized: boolean;
  analyticsAdded: boolean;
  suggestions: string[];
}

export async function optimizeMarketing(
  projectDir: string,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<MarketingResult> {
  console.log('\n📈 [Marketing] 开始营销优化...');

  const pastMarketing = memory.search('SEO analytics optimization', 'global', 2);
  let historyContext = '';
  if (pastMarketing.length > 0) {
    historyContext = '\n## 历史优化记录\n' + pastMarketing.map(r =>
      `- ${r.entry.content.slice(0, 200)}`
    ).join('\n');
  }

  const prompt = `# 项目营销优化
${historyContext}

请分析项目，提供：
1. SEO 优化建议（title, meta description, og:tags）
2. 分析代码嵌入位置
3. 用户增长策略`;

  try {
    const output = await agentCall(MARKETING_PROMPT, prompt, engine);
    
    const suggestions: string[] = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.match(/^\d+\./)) {
        suggestions.push(trimmed.replace(/^[-\*\d\.]+\s*/, ''));
      }
    }

    console.log(`  ✅ Marketing 完成 (${suggestions.length} 条建议)`);

    memory.put({
      namespace: 'global',
      type: 'pattern',
      content: `Marketing optimization completed. ${suggestions.slice(0, 3).join('; ')}`,
      score: 0.5,
    });

    return {
      success: true,
      seoOptimized: output.toLowerCase().includes('seo') || output.includes('meta'),
      analyticsAdded: output.toLowerCase().includes('analytics') || output.includes('统计'),
      suggestions,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ Marketing 失败: ${msg}`);
    return { success: false, seoOptimized: false, analyticsAdded: false, suggestions: [msg] };
  }
}

/** 收集用户反馈并生成优化需求 */
export async function collectFeedbackToRequirements(
  feedback: string,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<string[]> {
  const prompt = `# 用户反馈分析
${feedback}

请将用户反馈转化为产品优化需求。每条需求一句话。`;

  try {
    const output = await agentCall(MARKETING_PROMPT, prompt, engine);
    const reqs: string[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.match(/^\d+\./)) {
        reqs.push(trimmed.replace(/^[-\*\d\.]+\s*/, ''));
      }
    }
    return reqs.slice(0, 5);
  } catch {
    return [];
  }
}
