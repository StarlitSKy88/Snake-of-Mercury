/**
 * Planner Agent — 需求分析 + Task DAG 生成
 * 
 * 输入: 用户原始需求 + 市场调研
 * 输出: Task DAG（有依赖关系的任务图）
 * 
 * 与旧架构的关键区别:
 *   旧: 输出扁平 Sprint 数组，没有依赖关系
 *   新: 输出 Task DAG，Task 之间有 blockedBy 依赖
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES } from '../constraints/pua.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ System Prompt ============

const PLANNER_PROMPT = `你是产品规划师。你的任务是把产品需求拆解成可执行的任务DAG。

## 核心原则
1. 每个任务必须独立可测试、独立可交付
2. 任务之间用 blockedBy 表达依赖关系
3. 可以并行的任务不要串行
4. 每个任务标注影响级别（0=微调 1=功能 2=变更 3=关键）

${THREE_RED_LINES}

## 输出格式（严格 JSON）
{
  "tasks": [
    {
      "subject": "搭建Canvas渲染系统",
      "description": "使用HTML5 Canvas实现...",
      "blockedBy": [],
      "acceptanceCriteria": ["Canvas元素存在", "渲染循环60fps"],
      "impactLevel": 1
    },
    {
      "subject": "实现蛇移动逻辑",
      "description": "...",
      "blockedBy": [1],
      "acceptanceCriteria": ["方向键控制", "碰撞检测"],
      "impactLevel": 1
    }
  ]
}

## 规则
- Task ID 从1开始自增
- blockedBy 引用其他 Task 的 ID
- 每个 acceptance criterion 必须是可验证的（不是"用户体验好"）
- impactLevel: 0=修Bug/测试, 1=新功能, 2=API/DB变更, 3=部署/定价`;

// ============ 市场调研 ============

async function searchMarket(requirement: string): Promise<string> {
  let results = '';
  try {
    const { execCommand } = await import('../utils/agent-executor.js');
    const ghResult = await execCommand('gh', [
      'search', 'repos', requirement.slice(0, 80).replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).slice(0, 4).join(' '),
      '--sort', 'stars', '--limit', '3',
      '--json', 'fullName,description,stargazersCount'
    ], { timeout: 10000 });
    if (ghResult.success && ghResult.stdout) {
      const data = JSON.parse(ghResult.stdout);
      results = '## GitHub 同类项目\n' + data.map((r: any) =>
        `- ${r.fullName} ⭐${r.stargazersCount}: ${(r.description || '').slice(0, 100)}`
      ).join('\n');
    }
  } catch { /* gh not available */ }
  return results || '（市场搜索暂时不可用）';
}

// ============ 核心 ============

export async function plan(
  requirement: string,
  projectDir: string,
  engine: AgentEngine = 'minimax'
): Promise<TaskDAG> {
  const dag = new TaskDAG(projectDir);

  // 1. 市场调研
  console.log('🔍 [Planner] 市场调研...');
  const market = await searchMarket(requirement);

  // 2. 生成 Task DAG
  console.log('📋 [Planner] 生成任务 DAG...');
  const prompt = `# 用户需求
${requirement}

${market}

请拆解成 Task DAG。`;

  const output = await agentCall(PLANNER_PROMPT, prompt, engine);

  // 3. 解析 JSON 并创建 Task
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*\})/);
    const json = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(output);
    const tasks = json.tasks || [];

    for (const t of tasks) {
      dag.create(t.subject, {
        description: t.description || '',
        blockedBy: t.blockedBy || [],
        acceptanceCriteria: t.acceptanceCriteria || [],
        impactLevel: t.impactLevel ?? 1,
      });
    }
  } catch {
    // Fallback: 创建单个任务
    dag.create('实现产品需求', {
      description: requirement,
      acceptanceCriteria: ['功能完整', '可正常运行'],
    });
  }

  console.log(`[Planner] ✅ ${dag.list().length} 个任务`);
  return dag;
}
