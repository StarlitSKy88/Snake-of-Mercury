/**
 * Snake-of-Mercury v4 — 主入口
 * 
 * 支持: 多项目并行 | Handoff 续接
 */

import { CEO } from './agents/ceo.js';
import type { AgentEngine } from './utils/agent-executor.js';

async function main() {
  const args = process.argv.slice(2);
  
  // v4: --resume 恢复
  if (args[0] === '--resume') {
    console.log('🐍 Snake of Mercury v4 — 恢复模式');
    const ceo = new CEO();
    const projects = ceo.listProjects();
    if (projects.length === 0) {
      console.log('没有可恢复的项目');
      process.exit(0);
    }
    for (const p of projects) {
      if (ceo.resume(p)) {
        console.log('已恢复: ' + p.name);
      }
    }
    return;
  }

  // 允许无参数启动 (会尝试读取 REQUIREMENT.md)
  // 如果既无参数也无 REQUIREMENT.md，显示帮助

  const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;
  const projectDir = process.cwd();
  const ceo = new CEO(engine);

  // v4: Phase 0 桥接 — 读取 REQUIREMENT.md
  const { existsSync, readFileSync } = await import('fs');
  const { join } = await import('path');
  const reqPath = join(projectDir, '.tasks', 'REQUIREMENT.md');
  let requirements = args;
  
  if (requirements.length === 0 && existsSync(reqPath)) {
    console.log('📄 检测到 REQUIREMENT.md，自动读取...');
    const reqDoc = readFileSync(reqPath, 'utf-8');
    // 从文档中提取原始需求
    const origMatch = reqDoc.match(/原始需求[:：]\s*"([^"]+)"/);
    if (origMatch) {
      requirements = [origMatch[1]];
      console.log('需求: ' + requirements[0].slice(0, 80));
    }
  }

  // v4: 多项目并行
  console.log(`\n🐍 Snake of Mercury v4 | 引擎: ${engine}`);
  console.log(`项目数: ${requirements.length}`);

  const runs = requirements.map(async (req: string, i: number) => {
    const name = req.slice(0, 40).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-');
    const subDir = requirements.length > 1 ? projectDir + '/proj-' + (i + 1) : projectDir;
    const { mkdirSync } = await import('fs');
    mkdirSync(subDir, { recursive: true });
    
    const project = ceo.createProject(name, subDir);
    console.log(`\n[项目 ${i + 1}/${requirements.length}] ${name}`);
    await ceo.run(project, req);
    
    // v4: 保存 Handoff
    ceo.saveState(project);
  });

  await Promise.all(runs);

  // 汇总
  console.log('\n' + '='.repeat(50));
  console.log('📊 全部项目完成');
  for (const p of ceo.listProjects()) {
    console.log(`  ${p.name}: ${p.dag.summary()}`);
    const inbox = ceo.getUserInbox(p.id);
    if (inbox.length > 0) console.log(`    📬 ${inbox.length} 项待审批`);
  }
}

main().catch(console.error);
