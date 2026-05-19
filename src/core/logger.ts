/**
 * 持久化日志系统 T4.3
 * 结构: [时间] [级别] [模块] 消息 {JSON}
 */

import { appendFileSync, mkdirSync, existsSync, renameSync, statSync } from 'fs';
import { join } from 'path';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const LOG_DIR = join(process.cwd(), '.tasks', 'logs');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function ensureDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `${date}.log`);
}

function rotate(path: string) {
  try {
    if (existsSync(path) && statSync(path).size > MAX_SIZE) {
      renameSync(path, path.replace('.log', `.${Date.now()}.log`));
    }
  } catch {}
}

export function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>) {
  try {
    ensureDir();
    const path = getLogPath();
    rotate(path);
    const ts = new Date().toISOString();
    const dataStr = data ? ' ' + JSON.stringify(data) : '';
    appendFileSync(path, `[${ts}] [${level}] [${module}] ${message}${dataStr}\n`);
  } catch {}
}

export const logger = {
  info: (m: string, msg: string, d?: Record<string, unknown>) => log('INFO', m, msg, d),
  warn: (m: string, msg: string, d?: Record<string, unknown>) => log('WARN', m, msg, d),
  error: (m: string, msg: string, d?: Record<string, unknown>) => log('ERROR', m, msg, d),
};
