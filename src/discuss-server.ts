/**
 * Phase 0 对话服务器
 * 
 * 启动: npm run discuss
 * 打开: http://localhost:3100
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { discuss } from './agents/phase0-discuss.js';
import type { AgentEngine } from './utils/agent-executor.js';

const PORT = 3100;

// 简单的 JSON body 解析
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, content: string) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

const server = createServer(async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  const url = req.url || '/';

  // 主页
  if (url === '/' || url === '/index.html') {
    const htmlPath = join(import.meta.dirname, '..', 'discuss.html');
    if (existsSync(htmlPath)) {
      html(res, readFileSync(htmlPath, 'utf-8'));
    } else {
      html(res, '<h1>discuss.html 未找到</h1>');
    }
    return;
  }

  // Phase 0 对话 API
  if (url === '/api/discuss' && req.method === 'POST') {
    const body = await parseBody(req);
    const message = body.message || '';
    const engine = (process.env.HARNESS_ENGINE || 'minimax') as AgentEngine;
    const projectDir = process.cwd();

    try {
      const result = await discuss(message, projectDir, engine);
      json(res, { success: true, summary: result.summary, path: result.outputPath });
    } catch (err: any) {
      json(res, { success: false, error: err?.message || String(err) }, 500);
    }
    return;
  }

  // 健康检查
  if (url === '/api/health') {
    json(res, { status: 'ok' });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

export function startDiscussServer() {
  server.listen(PORT, () => {
    console.log(`\n🧠 Phase 0 对话窗口: http://localhost:${PORT}`);
    console.log('在浏览器中打开上述地址，与需求讨论 Agent 对话');
    console.log('按 Ctrl+C 退出\n');
  });
}

// 直接运行时启动服务器
if (process.argv[1]?.includes('discuss-server')) {
  startDiscussServer();
}
