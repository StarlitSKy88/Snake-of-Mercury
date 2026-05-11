/**
 * 本地存储管理
 * 实现数据持久化和历史记录管理
 */

import { randomUUID } from 'crypto';

export interface CounterState {
  value: number;
  lastModified: string;
  syncStatus: 'synced' | 'pending' | 'error';
}

export interface StorageRecord {
  id: string;
  state: CounterState;
  timestamp: number;
}

export class StorageManager {
  private readonly key: string;
  private readonly historyKey: string;
  private readonly MAX_HISTORY_SIZE = 1000;

  constructor(key: string = 'counter-state') {
    this.key = key;
    this.historyKey = `${key}-history`;
  }

  /**
   * 保存状态到本地存储
   */
  save(state: CounterState): void {
    try {
      const serialized = JSON.stringify(state);
      localStorage.setItem(this.key, serialized);
      this.addToHistory(state);
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        this.cleanupOldHistory();
        localStorage.setItem(this.key, JSON.stringify(state));
      } else {
        throw error;
      }
    }
  }

  /**
   * 从本地存储加载状态
   */
  load(): CounterState | null {
    try {
      const serialized = localStorage.getItem(this.key);
      if (!serialized) return null;

      const state = JSON.parse(serialized) as CounterState;
      
      // 验证状态结构
      if (!this.isValidState(state)) {
        console.warn('Invalid state structure, resetting');
        return null;
      }

      return state;
    } catch (error) {
      console.error('Failed to load from storage:', error);
      return null;
    }
  }

  /**
   * 验证状态对象是否有效
   */
  private isValidState(state: unknown): state is CounterState {
    if (typeof state !== 'object' || state === null) return false;
    
    const s = state as Record<string, unknown>;
    return (
      typeof s.value === 'number' &&
      typeof s.lastModified === 'string' &&
      ['synced', 'pending', 'error'].includes(s.syncStatus as string)
    );
  }

  /**
   * 添加到历史记录（LRU 策略）
   */
  private addToHistory(state: CounterState): void {
    try {
      const history = this.getHistory();
      
      const record: StorageRecord = {
        id: this.generateId(),
        state: { ...state },
        timestamp: Date.now()
      };

      history.unshift(record);

      // LRU 容量限制
      if (history.length > this.MAX_HISTORY_SIZE) {
        history.pop();
      }

      localStorage.setItem(this.historyKey, JSON.stringify(history));
    } catch (error) {
      console.error('Failed to add to history:', error);
    }
  }

  /**
   * 获取历史记录
   */
  getHistory(): CounterState[] {
    try {
      const serialized = localStorage.getItem(this.historyKey);
      if (!serialized) return [];

      const history = JSON.parse(serialized) as StorageRecord[];
      return history.map(r => r.state);
    } catch {
      return [];
    }
  }

  /**
   * 清理旧的历史记录（超过一半容量）
   */
  private cleanupOldHistory(): void {
    try {
      const history = this.getHistory();
      if (history.length > this.MAX_HISTORY_SIZE / 2) {
        const trimmed = history.slice(0, this.MAX_HISTORY_SIZE / 2);
        localStorage.setItem(this.historyKey, JSON.stringify(trimmed));
      }
    } catch (error) {
      console.error('Failed to cleanup history:', error);
    }
  }

  /**
   * 清空所有历史记录
   */
  clearHistory(): void {
    localStorage.removeItem(this.historyKey);
  }

  /**
   * 清空所有数据
   */
  clearAll(): void {
    localStorage.removeItem(this.key);
    this.clearHistory();
  }

  /**
   * 生成加密安全的 UUID
   */
  private generateId(): string {
    if (typeof window !== 'undefined' && window.crypto) {
      return crypto.randomUUID();
    }
    // Node.js 环境
    return randomUUID();
  }
}
