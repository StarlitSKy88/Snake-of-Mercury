/**
 * Rollback Manager Tests - 回滚管理器测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  loadRollbackHistory,
  saveRollbackHistory,
  createSnapshot,
  handleRollback,
  getRollbackStatus
} from '../rollback-manager.js';

describe('Rollback Manager', () => {
  const testDir = '/tmp/rollback-test';

  beforeEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadRollbackHistory', () => {
    it('should return empty array when no history file exists', () => {
      const history = loadRollbackHistory(testDir);
      expect(history).toEqual([]);
    });

    it('should load existing history file', () => {
      // 创建模拟历史数据
      const mockHistory = [
        {
          timestamp: '2024-01-01T00:00:00Z',
          sprintNumber: 1,
          reason: 'test rollback',
          snapshotPath: '/snapshot/1',
          score: 5,
          issues: ['issue1']
        }
      ];

      mkdirSync(join(testDir, '.rollback'), { recursive: true });
      writeFileSync(
        join(testDir, '.rollback', 'history.json'),
        JSON.stringify(mockHistory),
        'utf-8'
      );

      const history = loadRollbackHistory(testDir);

      expect(history).toHaveLength(1);
      expect(history[0].sprintNumber).toBe(1);
      expect(history[0].reason).toBe('test rollback');
    });

    it('should return empty array for invalid JSON', () => {
      mkdirSync(join(testDir, '.rollback'), { recursive: true });
      writeFileSync(
        join(testDir, '.rollback', 'history.json'),
        'invalid json',
        'utf-8'
      );

      const history = loadRollbackHistory(testDir);

      expect(history).toEqual([]);
    });
  });

  describe('saveRollbackHistory', () => {
    it('should create history file with record', () => {
      const record = {
        timestamp: new Date().toISOString(),
        sprintNumber: 1,
        reason: 'Supervisor ROLLBACK',
        snapshotPath: '/snapshot/1',
        score: 5,
        issues: ['issue1', 'issue2']
      };

      saveRollbackHistory(testDir, record);

      const historyFile = join(testDir, '.rollback', 'history.json');
      expect(existsSync(historyFile)).toBe(true);

      const loaded = loadRollbackHistory(testDir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].sprintNumber).toBe(1);
    });

    it('should limit history to MAX_ROLLBACK_HISTORY records', () => {
      const MAX_HISTORY = 10;

      // 添加超过限制的记录
      for (let i = 0; i < MAX_HISTORY + 5; i++) {
        saveRollbackHistory(testDir, {
          timestamp: new Date().toISOString(),
          sprintNumber: i,
          reason: `rollback ${i}`,
          snapshotPath: `/snapshot/${i}`,
          score: 5,
          issues: []
        });
      }

      const history = loadRollbackHistory(testDir);

      expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);
    });

    it('should add new records at the beginning', () => {
      const record1 = {
        timestamp: '2024-01-01T00:00:00Z',
        sprintNumber: 1,
        reason: 'first',
        snapshotPath: '/snapshot/1',
        score: 5,
        issues: []
      };

      const record2 = {
        timestamp: '2024-01-02T00:00:00Z',
        sprintNumber: 2,
        reason: 'second',
        snapshotPath: '/snapshot/2',
        score: 6,
        issues: []
      };

      saveRollbackHistory(testDir, record1);
      saveRollbackHistory(testDir, record2);

      const history = loadRollbackHistory(testDir);

      expect(history[0].sprintNumber).toBe(2);
      expect(history[1].sprintNumber).toBe(1);
    });
  });

  describe('rollback directory structure', () => {
    it('should create rollback directory if not exists', () => {
      expect(existsSync(join(testDir, '.rollback'))).toBe(false);

      saveRollbackHistory(testDir, {
        timestamp: new Date().toISOString(),
        sprintNumber: 1,
        reason: 'test',
        snapshotPath: '/test',
        score: 5,
        issues: []
      });

      expect(existsSync(join(testDir, '.rollback'))).toBe(true);
    });
  });

  describe('createSnapshot', () => {
    it('should create snapshot directory and metadata', async () => {
      const snapshotPath = await createSnapshot(
        testDir,
        1,
        'Test rollback',
        5.5,
        ['issue1', 'issue2']
      );

      // 验证快照目录被创建
      expect(snapshotPath).toContain('.rollback');
      expect(existsSync(snapshotPath)).toBe(true);

      // 验证元数据文件
      const metaFile = join(snapshotPath, 'snapshot-meta.json');
      expect(existsSync(metaFile)).toBe(true);

      const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
      expect(meta.sprintNumber).toBe(1);
      expect(meta.reason).toBe('Test rollback');
      expect(meta.score).toBe(5.5);
      expect(meta.issues).toEqual(['issue1', 'issue2']);
    });

    it('should create snapshot even without git repo', async () => {
      const snapshotPath = await createSnapshot(
        testDir,
        2,
        'No git repo',
        6.0,
        []
      );

      expect(snapshotPath).toContain('.rollback');
      expect(existsSync(snapshotPath)).toBe(true);
    });
  });

  describe('handleRollback', () => {
    it('should create snapshot and save history when rollback is triggered', async () => {
      const result = await handleRollback(
        testDir,
        1,
        {
          issues: ['issue1', 'issue2'],
          totalScore: 5.5
        }
      );

      // 验证回滚处理完成
      expect(typeof result).toBe('boolean');

      // 验证历史记录被保存
      const history = loadRollbackHistory(testDir);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].sprintNumber).toBe(1);
      expect(history[0].score).toBe(5.5);
    });

    it('should return false when rollback fails but snapshot is saved', async () => {
      const result = await handleRollback(
        testDir,
        2,
        {
          issues: ['critical issue'],
          totalScore: 2.0
        }
      );

      // 在非 git 仓库中，回滚会失败但快照仍会保存
      expect(result).toBe(false);

      // 验证历史记录仍被保存
      const history = loadRollbackHistory(testDir);
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('getRollbackStatus', () => {
    it('should return rollback status without git repo', async () => {
      const status = await getRollbackStatus(testDir);

      expect(status.canRollback).toBe(false);
      expect(status.lastStableCommit).toBeUndefined();
      expect(Array.isArray(status.rollbackHistory)).toBe(true);
    });

    it('should include rollback history in status', async () => {
      // 先添加一些历史记录
      saveRollbackHistory(testDir, {
        timestamp: new Date().toISOString(),
        sprintNumber: 1,
        reason: 'test',
        snapshotPath: '/snapshot/1',
        score: 5.0,
        issues: []
      });

      const status = await getRollbackStatus(testDir);

      expect(status.rollbackHistory.length).toBeGreaterThan(0);
      expect(status.rollbackHistory[0].sprintNumber).toBe(1);
    });
  });

  describe('saveRollbackHistory edge cases', () => {
    it('should trim history to MAX_ROLLBACK_HISTORY records', () => {
      const MAX_HISTORY = 10;

      // 添加正好 MAX_HISTORY 条记录
      for (let i = 0; i < MAX_HISTORY; i++) {
        saveRollbackHistory(testDir, {
          timestamp: new Date().toISOString(),
          sprintNumber: i,
          reason: `rollback ${i}`,
          snapshotPath: `/snapshot/${i}`,
          score: 5.0,
          issues: []
        });
      }

      const history = loadRollbackHistory(testDir);

      // 验证不超过 MAX_ROLLBACK_HISTORY
      expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);
    });

    it('should add new records at the beginning of history', () => {
      // 清空现有历史
      const historyFile = join(testDir, '.rollback', 'history.json');
      if (existsSync(historyFile)) {
        rmSync(historyFile);
      }

      // 添加第一条记录
      saveRollbackHistory(testDir, {
        timestamp: '2024-01-01T00:00:00Z',
        sprintNumber: 1,
        reason: 'first',
        snapshotPath: '/snapshot/1',
        score: 5.0,
        issues: []
      });

      // 添加第二条记录
      saveRollbackHistory(testDir, {
        timestamp: '2024-01-02T00:00:00Z',
        sprintNumber: 2,
        reason: 'second',
        snapshotPath: '/snapshot/2',
        score: 6.0,
        issues: []
      });

      const history = loadRollbackHistory(testDir);

      // 验证最新记录在最前
      expect(history[0].sprintNumber).toBe(2);
      expect(history[1].sprintNumber).toBe(1);
    });
  });
});
