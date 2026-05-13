/**
 * Snake-of-Mercury v3 — 主入口
 * 
 * 基于三原语架构: Agent Loop + Task DAG + ProtocolRequest
 */

import { CEO } from './agents/ceo.js';
import type { AgentEngine } from './utils/agent-executor.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Snake of Mercury v3\n用法: npm run v3 -- "产品需求"');
    process.exit(1);
  }

  const requirement = args[0];
  const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;
  const projectDir = process.cwd();

  console.log(`\n🐍 Snake of Mercury v3 | 引擎: ${engine}`);
  console.log(`需求: ${requirement.slice(0, 80)}`);

  const ceo = new CEO(engine);
  const project = ceo.createProject(
    requirement.slice(0, 50).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-'),
    projectDir
  );

  await ceo.run(project, requirement);

  // 显示待审批
  const inbox = ceo.getUserInbox(project.id);
  if (inbox.length > 0) {
    console.log(`\n📬 待审批: ${inbox.length} 项`);
    for (const req of inbox) {
      console.log(`  [${req.id}] ${req.subject}`);
    }
  }
}

main().catch(console.error);
