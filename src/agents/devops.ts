/**
 * DevOps Agent — 部署 + 监控 + 自动修复
 * 
 * 负责:
 * 1. 项目部署（通过 CodeExecutor 验证可部署性）
 * 2. 服务健康监控
 * 3. 故障自动修复（Ralph Loop 内重试）
 * 4. 向 CEO 汇报状态
 */

import { TaskDAG, type Task } from '../core/task-dag.js';
import { agentCall } from '../core/agent-loop.js';
import { AgentMemory } from '../core/memory.js';
import { THREE_RED_LINES } from '../constraints/pua.js';
import type { AgentEngine } from '../utils/agent-executor.js';

const DEVOPS_PROMPT = `你是运维工程师。负责项目的部署、监控和故障修复。

## 职责
1. 检查项目是否可部署（构建通过、文件完整）
2. 生成部署脚本（nginx配置、PM2配置、Dockerfile等）
3. 监控告警规则
4. 故障时自动修复

## 规则
- 部署前先验证
- 任何变更配回滚方案
- 关键操作需审批（通过 Protocol）

${THREE_RED_LINES}

## 输出格式
\`\`\`yaml:deploy/nginx.conf
# nginx config
\`\`\`
或
\`\`\`json:deploy/pm2.json
{ "apps": [...] }
\`\`\`
`;

export interface DeployResult {
  success: boolean;
  url?: string;
  configs: string[];
  issues: string[];
}

export async function deploy(
  projectDir: string,
  dag: TaskDAG,
  memory: AgentMemory,
  engine: AgentEngine = 'minimax'
): Promise<DeployResult> {
  console.log('\n🚀 [DevOps] 开始部署检查...');
  
  const tasks = dag.list();
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed');

  if (failed.length > 0) {
    console.log(`  ⚠️  ${failed.length} 个任务失败，暂停部署`);
    return { success: false, configs: [], issues: failed.map(t => t.subject) };
  }

  if (completed.length === 0) {
    return { success: false, configs: [], issues: ['无已完成任务'] };
  }

  // 搜索历史部署记忆
  const pastDeploys = memory.search('deploy config', 'global', 3);
  let historyContext = '';
  if (pastDeploys.length > 0) {
    historyContext = '\n## 历史部署记录\n' + pastDeploys.map(r => 
      `- ${r.entry.content.slice(0, 200)}`
    ).join('\n');
  }

  // 生成部署配置
  const prompt = `# 项目部署
已完成 ${completed.length}/${tasks.length} 个任务。
${historyContext}

请分析项目结构，生成部署配置。
如果是前端项目：生成 nginx 静态文件配置
如果是 Node.js 项目：生成 PM2 配置`;

  try {
    const output = await agentCall(DEVOPS_PROMPT, prompt, engine);
    
    // 提取配置文件
    const configRegex = /```\w+:([^\n]+)\n([\s\S]*?)```/g;
    const configs: string[] = [];
    let match;
    while ((match = configRegex.exec(output)) !== null) {
      configs.push(match[1]);
    }

    console.log(`  ✅ DevOps 完成 (${configs.length} 个配置文件)`);
    
    memory.put({
      namespace: 'global',
      type: 'pattern',
      content: `Deploy for project completed. ${configs.length} configs generated.`,
      score: 0.6,
    });

    return { success: true, configs, issues: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ DevOps 失败: ${msg}`);
    return { success: false, configs: [], issues: [msg] };
  }
}

/** 健康检查 */
export async function healthCheck(
  projectDir: string,
  engine: AgentEngine = 'minimax'
): Promise<{ healthy: boolean; issues: string[] }> {
  // 检查关键文件是否存在
  const { existsSync } = await import('fs');
  const { join } = await import('path');
  
  const issues: string[] = [];
  
  const indexPath = join(projectDir, 'index.html');
  const packageJson = join(projectDir, 'package.json');
  
  if (!existsSync(indexPath) && !existsSync(packageJson)) {
    issues.push('未找到 index.html 或 package.json');
  }

  return { healthy: issues.length === 0, issues };
}
