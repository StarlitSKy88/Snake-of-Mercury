/**
 * Rollback Manager - 代码回滚管理
 *
 * 当 Supervisor 裁决为 ROLLBACK 时，自动回滚到上一个稳定版本
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// ============= 常量 =============

const ROLLBACK_DIR = '.rollback';
const MAX_ROLLBACK_HISTORY = 10;

// 允许的 git 命令白名单
const ALLOWED_GIT_COMMANDS = [
  'status', 'diff', 'log', 'branch', 'reset', 'rev-parse', 'stash'
];

// 允许的 git 命令参数白名单（简单的字母数字和横杠）
const SAFE_GIT_ARGS_PATTERN = /^[a-zA-Z0-9\-_./]+$/;

/**
 * 回滚历史记录
 */
export interface RollbackRecord {
  timestamp: string;
  sprintNumber: number;
  reason: string;
  snapshotPath: string;
  score: number;
  issues: string[];
}

/**
 * 回滚状态
 */
export interface RollbackStatus {
  canRollback: boolean;
  lastStableCommit?: string;
  rollbackHistory: RollbackRecord[];
}

// ============= 快照管理 =============

/**
 * 创建代码快照
 */
export async function createSnapshot(
  projectDir: string,
  sprintNumber: number,
  reason: string,
  score: number,
  issues: string[]
): Promise<string> {
  console.log(`[Rollback] 创建代码快照 (Sprint ${sprintNumber})...`);

  const snapshotDir = join(projectDir, ROLLBACK_DIR, `sprint-${sprintNumber}-${Date.now()}`);
  mkdirSync(snapshotDir, { recursive: true });

  try {
    // 获取当前 git 状态
    const gitStatus = await execGitCommand(projectDir, ['status', '--porcelain']);
    const gitDiff = await execGitCommand(projectDir, ['diff', '--stat']);

    // 保存快照元数据
    const snapshotMeta = {
      timestamp: new Date().toISOString(),
      sprintNumber,
      reason,
      score,
      issues,
      gitStatus: gitStatus || 'clean',
      gitDiff: gitDiff || ''
    };

    writeFileSync(
      join(snapshotDir, 'snapshot-meta.json'),
      JSON.stringify(snapshotMeta, null, 2),
      'utf-8'
    );

    // 如果有 git 仓库，创建一个备份分支
    if (existsSync(join(projectDir, '.git'))) {
      const branchName = sanitizeString(`rollback-sprint-${sprintNumber}-${Date.now()}`);
      try {
        const result = await execGitCommand(projectDir, ['branch', branchName]);
        if (result !== null) {
          console.log(`[Rollback] 快照分支已创建: ${branchName}`);
        }
      } catch {
        // 静默处理创建分支失败的情况
      }
    }

    console.log(`[Rollback] 快照已保存: ${snapshotDir}`);
    return snapshotDir;

  } catch (error) {
    console.error(`[Rollback] 创建快照失败:`, error);
    return snapshotDir;
  }
}

// ============= 回滚执行 =============

/**
 * 执行回滚
 */
export async function executeRollback(
  projectDir: string,
  sprintNumber: number
): Promise<{ success: boolean; message: string }> {
  console.log(`[Rollback] 开始回滚 Sprint ${sprintNumber}...`);

  // 检查是否是 git 仓库
  if (!existsSync(join(projectDir, '.git'))) {
    return {
      success: false,
      message: '非 git 仓库，无法执行回滚'
    };
  }

  try {
    // 查找最近的稳定提交
    const lastStableCommit = await findLastStableCommit(projectDir);

    if (!lastStableCommit) {
      return {
        success: false,
        message: '未找到可回滚的稳定版本'
      };
    }

    console.log(`[Rollback] 回滚到: ${lastStableCommit}`);

    // 保存当前更改（不提交）
    const currentChanges = await execGitCommand(projectDir, ['diff', '--cached']);
    const workingChanges = await execGitCommand(projectDir, ['diff']);

    if (currentChanges || workingChanges) {
      // 将当前更改保存到临时文件
      const stashDir = join(projectDir, ROLLBACK_DIR, `stash-${Date.now()}`);
      mkdirSync(stashDir, { recursive: true });

      if (currentChanges) {
        writeFileSync(join(stashDir, 'cached-diff.patch'), currentChanges, 'utf-8');
      }
      if (workingChanges) {
        writeFileSync(join(stashDir, 'working-diff.patch'), workingChanges, 'utf-8');
      }
      writeFileSync(join(stashDir, 'readme.txt'), '回滚前保存的更改，请手动检查是否需要恢复', 'utf-8');

      console.log(`[Rollback] 当前更改已保存到: ${stashDir}`);
    }

    // 执行回滚（保留工作目录的更改）
    await execGitCommand(projectDir, ['reset', '--soft', lastStableCommit]);

    console.log(`[Rollback] 回滚成功！`);

    return {
      success: true,
      message: `已回滚到 ${lastStableCommit}，更改已保留在工作目录`
    };

  } catch (error) {
    console.error(`[Rollback] 回滚失败:`, error);
    return {
      success: false,
      message: `回滚失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * 查找上一个稳定提交
 */
async function findLastStableCommit(projectDir: string): Promise<string | null> {
  try {
    // 获取最近 10 个提交，查找没有 rollback 标记的
    const log = await execGitCommand(
      projectDir,
      ['log', '--oneline', '-10', '--grep', '!rollback', '--grep', '!broken', '--grep', '!fix']
    );

    if (!log) {
      // 如果没有找到，使用 HEAD~
      const head = await execGitCommand(projectDir, ['rev-parse', 'HEAD~1']);
      return head?.trim() || null;
    }

    const lines = log.trim().split('\n');
    if (lines.length > 0) {
      return lines[0].split(' ')[0];
    }

    return null;

  } catch {
    // 如果 git 命令失败，尝试获取 HEAD~
    try {
      const head = await execGitCommand(projectDir, ['rev-parse', 'HEAD~1']);
      return head?.trim() || null;
    } catch {
      return null;
    }
  }
}

// ============= 回滚历史 =============

/**
 * 加载回滚历史
 */
export function loadRollbackHistory(projectDir: string): RollbackRecord[] {
  const historyFile = join(projectDir, ROLLBACK_DIR, 'history.json');

  if (!existsSync(historyFile)) {
    return [];
  }

  try {
    const content = readFileSync(historyFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * 保存回滚历史
 */
export function saveRollbackHistory(
  projectDir: string,
  record: RollbackRecord
): void {
  const historyFile = join(projectDir, ROLLBACK_DIR, 'history.json');
  const history = loadRollbackHistory(projectDir);

  // 添加新记录，保留最近的 MAX_ROLLBACK_HISTORY 条
  history.unshift(record);
  const trimmedHistory = history.slice(0, MAX_ROLLBACK_HISTORY);

  mkdirSync(join(projectDir, ROLLBACK_DIR), { recursive: true });
  writeFileSync(historyFile, JSON.stringify(trimmedHistory, null, 2), 'utf-8');
}

/**
 * 获取回滚状态
 */
export async function getRollbackStatus(
  projectDir: string
): Promise<RollbackStatus> {
  const history = loadRollbackHistory(projectDir);
  const isGitRepo = existsSync(join(projectDir, '.git'));

  let lastStableCommit: string | undefined;

  if (isGitRepo) {
    try {
      const commit = await findLastStableCommit(projectDir);
      lastStableCommit = commit ?? undefined;
    } catch {
      // 忽略错误
    }
  }

  return {
    canRollback: isGitRepo && !!lastStableCommit,
    lastStableCommit,
    rollbackHistory: history
  };
}

// ============= 辅助函数 =============

/**
 * 验证 git 命令参数安全性
 */
function validateGitArgs(command: string, args: string[]): boolean {
  // 验证命令是白名单中的
  if (!ALLOWED_GIT_COMMANDS.includes(command)) {
    return false;
  }

  // 验证所有参数都是安全的
  for (const arg of args) {
    if (!SAFE_GIT_ARGS_PATTERN.test(arg)) {
      return false;
    }
  }

  return true;
}

/**
 * 清理字符串中的危险字符（用于 branch 名称等）
 */
function sanitizeString(input: string): string {
  return input.replace(/[^a-zA-Z0-9\-_]/g, '');
}

/**
 * 执行 git 命令
 */
async function execGitCommand(
  projectDir: string,
  args: string[]
): Promise<string | null> {
  // 验证参数安全性
  if (args.length === 0) {
    return null;
  }

  const command = args[0];
  if (!validateGitArgs(command, args.slice(1))) {
    console.error(`[Rollback] 拒绝执行不安全的 git 命令: git ${args.join(' ')}`);
    return null;
  }

  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        resolve(null);
      }
    });

    proc.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * 处理 ROLLBACK 裁决
 */
export async function handleRollback(
  projectDir: string,
  sprintNumber: number,
  report: {
    issues: string[];
    totalScore: number;
  }
): Promise<boolean> {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`检测到 ROLLBACK 裁决 (Sprint ${sprintNumber})`);
  console.log(`${'='.repeat(50)}\n`);

  // 1. 创建快照
  const snapshotPath = await createSnapshot(
    projectDir,
    sprintNumber,
    'Supervisor ROLLBACK 裁决',
    report.totalScore,
    report.issues
  );

  // 2. 记录回滚历史
  const record: RollbackRecord = {
    timestamp: new Date().toISOString(),
    sprintNumber,
    reason: 'Supervisor ROLLBACK 裁决',
    snapshotPath,
    score: report.totalScore,
    issues: report.issues
  };
  saveRollbackHistory(projectDir, record);

  // 3. 尝试执行回滚
  const rollbackResult = await executeRollback(projectDir, sprintNumber);

  if (rollbackResult.success) {
    console.log(`[Rollback] ${rollbackResult.message}`);
    return true;
  } else {
    console.log(`[Rollback] ${rollbackResult.message}`);
    console.log(`[Rollback] 快照已保存，可以手动回滚`);
    return false;
  }
}
