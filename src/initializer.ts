/**
 * Initializer — Anthropic Article 1: 项目环境初始化
 *
 * 等价于 Anthropic 的 "Initializer Agent"：
 * - 生成 init.sh（一行启动项目）
 * - 生成 progress.json（项目进度日记）
 * - 支持读取和更新进度（断点续跑）
 */

import { writeFileSync, readFileSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';

/**
 * 根据 tech stack 生成 init.sh
 */
export function generateInitSh(projectDir: string, techDirection: string): string {
  const td = (techDirection || '').toLowerCase();
  let content = '#!/bin/bash\nset -e\n\n';

  if (td.includes('next') || td.includes('react') || td.includes('vite')) {
    content += 'npm install\nnpm run dev\n';
  } else if (td.includes('python') || td.includes('flask') || td.includes('fastapi')) {
    content += 'pip install -r requirements.txt\npython app.py\n';
  } else if (td.includes('go')) {
    content += 'go mod tidy\ngo run .\n';
  } else {
    content += 'npm install\nnpm start\n';
  }

  const path = join(projectDir, 'init.sh');
  writeFileSync(path, content);
  try { chmodSync(path, 0o755); } catch { /* Windows 兼容 */ }
  return path;
}

/**
 * 生成初始 progress.json（Anthropic progress tracking file）
 *
 * 格式对齐 Anthropic 的 claude-progress.txt 语义，
 * 使用 JSON 以便程序化读写。
 */
export function generateProgressFile(
  projectDir: string,
  requirement: string,
  sprintCount: number
): string {
  const progress = {
    project: requirement.slice(0, 100),
    createdAt: new Date().toISOString(),
    sprints: [] as Array<{
      sprintNumber: number;
      status: 'pending' | 'in_progress' | 'passed' | 'failed';
      startedAt: string | null;
      completedAt: string | null;
      iterations: number;
      notes: string;
    }>,
  };

  for (let i = 1; i <= sprintCount; i++) {
    progress.sprints.push({
      sprintNumber: i,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      iterations: 0,
      notes: '',
    });
  }

  const path = join(projectDir, 'progress.json');
  writeFileSync(path, JSON.stringify(progress, null, 2));
  return path;
}

/**
 * 读取 progress.json
 */
export function readProgressFile(projectDir: string): Record<string, unknown> | null {
  const path = join(projectDir, 'progress.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 更新 progress.json 中某个 Sprint 的状态
 */
export function updateProgressSprint(
  projectDir: string,
  sprintNumber: number,
  updates: { status?: string; iterations?: number; notes?: string }
): void {
  const path = join(projectDir, 'progress.json');
  if (!existsSync(path)) return;
  try {
    const progress = JSON.parse(readFileSync(path, 'utf-8'));
    const sprint = (progress.sprints as Array<Record<string, unknown>>)?.find(
      (s) => s.sprintNumber === sprintNumber
    );
    if (sprint) {
      if (updates.status) sprint.status = updates.status;
      if (updates.iterations !== undefined) sprint.iterations = updates.iterations;
      if (updates.notes) sprint.notes = updates.notes;
      if (updates.status === 'in_progress') sprint.startedAt = new Date().toISOString();
      if (updates.status === 'passed' || updates.status === 'failed') {
        sprint.completedAt = new Date().toISOString();
      }
      writeFileSync(path, JSON.stringify(progress, null, 2));
    }
  } catch {
    // 损坏则忽略
  }
}
