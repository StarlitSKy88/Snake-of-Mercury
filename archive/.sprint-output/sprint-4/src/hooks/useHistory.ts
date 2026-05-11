/**
 * 历史记录 Hook（带 LRU 限制）
 */

import { useState, useCallback, useRef } from 'react';
import { HistoryItem } from '../types';
import { generateId } from '../utils/idGenerator';
import { DEFAULT_CONFIG } from '../utils/validator';

interface UseHistoryOptions {
  maxSize?: number;
  initialHistory?: HistoryItem[];
}

interface UseHistoryReturn {
  history: HistoryItem[];
  addRecord: (previousValue: number, newValue: number, action: HistoryItem['action']) => void;
  clearHistory: () => void;
  getRecentHistory: (count: number) => HistoryItem[];
  exportHistory: () => HistoryItem[];
}

/**
 * 历史记录管理 Hook
 * @param options - 配置选项
 * @returns 历史记录操作接口
 */
export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { maxSize = DEFAULT_CONFIG.maxHistorySize, initialHistory = [] } = options;

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    // 初始化时截断到最大容量
    return initialHistory.slice(-maxSize);
  });

  const historyRef = useRef(history);
  historyRef.current = history;

  /**
   * 添加历史记录
   * 使用 LRU 策略，超过容量时移除最旧的记录
   */
  const addRecord = useCallback(
    (previousValue: number, newValue: number, action: HistoryItem['action']) => {
      const newRecord: HistoryItem = {
        id: generateId(),
        previousValue,
        newValue,
        timestamp: Date.now(),
        action,
      };

      setHistory((prev) => {
        const updated = [...prev, newRecord];
        // LRU: 超过容量时移除最旧的记录
        if (updated.length > maxSize) {
          return updated.slice(-maxSize);
        }
        return updated;
      });
    },
    [maxSize]
  );

  /**
   * 清空历史记录
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  /**
   * 获取最近的历史记录
   * @param count - 数量
   * @returns 最近的历史记录数组
   */
  const getRecentHistory = useCallback(
    (count: number): HistoryItem[] => {
      return historyRef.current.slice(-count);
    },
    []
  );

  /**
   * 导出完整历史记录
   * @returns 历史记录数组副本
   */
  const exportHistory = useCallback((): HistoryItem[] => {
    return [...historyRef.current];
  }, []);

  return {
    history,
    addRecord,
    clearHistory,
    getRecentHistory,
    exportHistory,
  };
}
