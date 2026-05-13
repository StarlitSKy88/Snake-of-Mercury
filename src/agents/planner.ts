/**
 * Planner Agent — SPECIFY → Task DAG 生成
 * 
 * Google Agent Skills 式 Spec 先行:
 *   1. SPECIFY: 输出假设 + 6区域 Spec → 用户确认
 *   2. PLAN:   只读分析 → 依赖图 → 垂直切片
 *   3. TASKS:  生成 Task DAG
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { THREE_RED_LINES, RATIONALIZATIONS, RED_FLAGS } from '../constraints/pua.js';
import type { AgentEngine } from '../utils/agent-executor.js';

// ============ System Prompt ============

const PLANNER_PROMPT = `你是产品规划师。你的任务分三个阶段：SPECIFY → PLAN → TASKS。

## Phase 1: SPECIFY (假设显式化)
在写任何计划之前，先列出你的假设。不列假设 = 最危险的误解。

输出格式:
## ASSUMPTIONS I'M MAKING
1. 这是一个 [web/CLI/移动端] 应用
2. 技术栈: [如果未指定，默认 TypeScript + HTML]
3. 目标用户: [如果未指定，推断并说明]
4. 部署方式: [如果未指定，默认静态文件]
5. [其他关键假设]

→ 以上假设如有不对请纠正，我将基于这些继续。

## Phase 2: PLAN (只读分析，不生成代码)
然后输出结构化 Spec:

## Spec: [项目名]

### Objective
[我们构建什么，为什么，成功标准]

### Commands
- Build: [构建命令]
- Test: [测试命令]
- Dev: [开发命令]

### Project Structure
src/        → 源代码
tests/      → 测试

### Code Style
[一个真实代码片段胜过三段描述]

### Testing Strategy
- 框架: Vitest
- 位置: src/**/*.test.ts
- 覆盖率目标: 核心逻辑 80%+

### Boundaries
- Always: 运行测试、验证输入、遵守命名规范
- Ask First: 数据库变更、添加依赖、改 CI 配置
- Never: 提交密钥、删测试、硬编码凭证

## Phase 3: TASKS (生成 Task DAG)
然后拆解成任务。

## 核心原则
1. **垂直切片**: 一个完整用户路径 = 一个任务。不要把所有数据库放一个任务、所有 UI 放另一个。
2. **验收标准必须可验证**: 不是"用户体验好"，是"页面 LCP < 2.5s"
3. **验收标准必须可实现**: 不要要求"与百度时间API对比误差<1秒"，时钟项目用系统时间即可
4. **每个任务最多改 ~5 个文件**
5. 用 blockedBy 表达依赖

### 验收标准编写规则
- ✅ "Canvas元素存在，id为'clock'"  (可检测)
- ✅ "每秒更新显示时间"  (可验证行为)
- ✅ "文件大小 > 500 bytes"  (可量化)
- ❌ "与百度时间对比误差<1秒"  (过度要求，不需要外部API)
- ❌ "用户体验好"  (不可验证)
- ❌ "性能优秀"  (无量化指标)

## 影响级别
- 0: 测试/文案/微调
- 1: 新功能
- 2: API/DB变更
- 3: 部署/定价

${THREE_RED_LINES}
${RATIONALIZATIONS}
${RED_FLAGS}

## 最终输出格式（无论前面写了多少分析，必须在此输出 JSON）
**重要**: 不要在输出 Assumptions 后等待用户确认。直接基于你的假设继续输出完整 JSON。
如果用户不同意假设，他们会在下一轮告诉你。先输出 JSON 让流水线继续。


{
  "spec": { "objective": "...", "commands": {...}, ... },
  "tasks": [
    {
      "subject": "创建HTML基础结构",
      "description": "...",
      "blockedBy": [],
      "acceptanceCriteria": ["可验证条件1", "可验证条件2"],
      "impactLevel": 1
    }
  ]
}`;

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
  return results || '（市场搜索不可用，基于已有知识推断）';
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

  // 2. SPECIFY + PLAN + TASKS
  console.log('📋 [Planner] SPECIFY → PLAN → TASKS...');
  const prompt = `# 用户需求
${requirement}

${market}

请按 Phase 1→2→3 顺序执行。先生成 Spec，再生成 Task DAG。`;

  const output = await agentCall(PLANNER_PROMPT, prompt, engine);

  // 3. 提取并显示 Spec
  const specMatch = output.match(/## ASSUMPTIONS([\s\S]*?)(?=## Spec:|$)/i) ||
                    output.match(/ASSUMPTIONS([\s\S]*?)(?=##|$)/i);
  if (specMatch) {
    console.log('\n' + '='.repeat(50));
    console.log('📐 Planner 假设 & Spec:');
    console.log(output.match(/(?:## )?ASSUMPTIONS[\s\S]*?(?=\{|$)/i)?.[0]?.slice(0, 800) || '(未检测到)');
  }

  // 4. 解析 JSON → Task DAG
  try {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*"tasks"[\s\S]*\})/);
    const json = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(output);
    const tasks = json.tasks || [];

    // 验收标准质检：过滤不可验证的标准
    const unverifiablePatterns = [
      /用户体验/, /性能优秀/, /好看/, /好用/, /流畅/,
      /百度.*对比/, /NTP.*对比/, /外部.*验证/,
      /SEO.*排名/, /用户增长/, /转化率/
    ];

    for (const t of tasks) {
      const cleanCriteria = (t.acceptanceCriteria || []).filter((c: string) => {
        const isUnverifiable = unverifiablePatterns.some(p => p.test(c));
        if (isUnverifiable) {
          console.log(`  ⚠️  移除不可验证标准: "${c}"`);
        }
        return !isUnverifiable;
      });

      // 如果没有有效标准，添加默认标准
      if (cleanCriteria.length === 0) {
        cleanCriteria.push('功能实现且可正常运行', '通过 CodeExecutor 验证');
      }

      dag.create(t.subject, {
        description: (t.description || '').slice(0, 500),
        blockedBy: (t.blockedBy || []).slice(0, 5),
        acceptanceCriteria: cleanCriteria.slice(0, 3),
        impactLevel: Math.min(2, Math.max(0, t.impactLevel ?? 1)), // 限制在 0-2，避免 P3
      });
    }
  } catch (e) {
    console.log(`  ⚠️  JSON 解析失败，生成默认任务。`);
    dag.create('实现产品需求', {
      description: requirement.slice(0, 500),
      acceptanceCriteria: ['功能完整可运行', '通过 CodeExecutor 验证'],
      impactLevel: 1,
    });
  }

  console.log(`[Planner] ✅ ${dag.list().length} 个任务 (已质检)`);
  return dag;
}
