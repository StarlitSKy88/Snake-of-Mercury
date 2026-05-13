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

  if (args.length === 0) {
    console.log('Snake of Mercury v4\n用法: npm run v3 -- "需求" ["需求2" ...]\n恢复: npm run v3 -- --resume');
    process.exit(1);
  }

  const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;
  const projectDir = process.cwd();
  const ceo = new CEO(engine);

  // v4: 多项目并行
  const requirements = args;
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
