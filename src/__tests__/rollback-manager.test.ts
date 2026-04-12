/**
 * Rollback Manager Tests - 回滚管理器测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  loadRollbackHistory,
  saveRollbackHistory
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
});
