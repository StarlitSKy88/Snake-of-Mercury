/**
 * Phase 0 CLI — 需求拷问工具
 * 
 * 用法: npm run discuss -- "你的模糊想法"
 */

import { discuss } from './agents/phase0-discuss.js';
import type { AgentEngine } from './utils/agent-executor.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Phase 0: 需求拷问\n用法: npm run discuss -- "你的模糊想法"');
    process.exit(1);
  }

  const requirement = args.join(' ');
  const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;

  console.log('🐍 Phase 0: 需求拷问 | 引擎: ' + engine);
  console.log('='.repeat(60));

  await discuss(requirement, process.cwd(), engine);
}

main().catch(console.error);
