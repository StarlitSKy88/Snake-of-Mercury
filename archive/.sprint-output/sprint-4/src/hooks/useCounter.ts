/**
 * 计数器 Hook
 * 集成验证、历史记录、Toast 反馈
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { CounterState, SyncStatus, CounterConfig } from '../types';
import { useHistory } from './useHistory';
import { useToast } from './useToast';
import { validateCounterValue, validateStep, safeIncrement, safeDecrement, DEFAULT_CONFIG } from '../utils/validator';
import { generateId } from '../utils/idGenerator';

interface UseCounterOptions {
  initialValue?: number;
  config?: Partial<CounterConfig>;
}

interface UseCounterReturn {
  // 状态
  value: number;
  state: CounterState;
  history: import('../types').HistoryItem[];
  syncStatus: SyncStatus;
  isLoading: boolean;

  // 操作
  increment: (step?: number) => boolean;
  decrement: (step?: number) => boolean;
  reset: () => void;
  setValue: (value: number) => boolean;

  // 辅助
  canIncrement: () => boolean;
  canDecrement: () => boolean;
  clearHistory: () => void;
}

type NetworkStatus = 'online' | 'offline';

/**
 * 计数器管理 Hook
 * @param options - 配置选项
 * @returns 计数器操作接口
 */
export function useCounter(options: UseCounterOptions = {}): UseCounterReturn {
  const {
    initialValue = 0,
    config = {},
  } = options;

  const fullConfig: CounterConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // 计数器状态
  const [value, setValueState] = useState<number>(() => {
    const errors = validateCounterValue(initialValue, fullConfig);
    if (errors.length > 0) {
      console.warn('Invalid initial value, using 0:', errors);
      return 0;
    }
    return initialValue;
  });

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);

  // 同步状态
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastSyncTime: null,
    pendingChanges: 0,
    isSyncing: false,
  });

  // 网络状态监听器
  const handleOnline = useCallback(() => {
    setSyncStatus((prev) => ({ ...prev, isOnline: true }));
  }, []);

  const handleOffline = useCallback(() => {
    setSyncStatus((prev) => ({ ...prev, isOnline: false }));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, [handleOnline, handleOffline]);

  // Toast 通知
  const toast = useToast();

  // 历史记录
  const historyHook = useHistory({ maxSize: fullConfig.maxHistorySize });

  // 状态 ID（用于追踪）
  const stateIdRef = useRef(generateId());

  /**
   * 创建新的计数器状态
   */
  const createState = useCallback((): CounterState => {
    return {
      value,
      id: stateIdRef.current,
      timestamp: Date.now(),
      step: fullConfig.defaultStep,
    };
  }, [value, fullConfig.defaultStep]);

  /**
   * 检查是否可以增加
   */
  const canIncrement = useCallback((): boolean => {
    const newValue = safeIncrement(value, fullConfig.defaultStep, fullConfig);
    return newValue !== null;
  }, [value, fullConfig]);

  /**
   * 检查是否可以减少
   */
  const canDecrement = useCallback((): boolean => {
    const newValue = safeDecrement(value, fullConfig.defaultStep, fullConfig);
    return newValue !== null;
  }, [value, fullConfig]);

  /**
   * 增加计数器
   */
  const increment = useCallback(
    (step?: number): boolean => {
      const stepValue = step ?? fullConfig.defaultStep;

      // 验证步进值
      const stepError = validateStep(stepValue);
      if (stepError) {
        toast.error(stepError.message);
        return false;
      }

      // 验证当前值
      const valueErrors = validateCounterValue(value, fullConfig);
      if (valueErrors.length > 0) {
        valueErrors.forEach((err) => toast.error(err.message));
        return false;
      }

      // 计算新值
      const newValue = safeIncrement(value, stepValue, fullConfig);
      if (newValue === null) {
        toast.warning(`已达最大值 ${fullConfig.maxValue}`);
        return false;
      }

      // 更新状态
      const previousValue = value;
      setValueState(newValue);
      stateIdRef.current = generateId();

      // 记录历史
      historyHook.addRecord(previousValue, newValue, 'increment');

      // 更新同步状态
      setSyncStatus((prev) => ({
        ...prev,
        pendingChanges: prev.pendingChanges + 1,
        lastSyncTime: prev.isOnline ? Date.now() : prev.lastSyncTime,
      }));

      return true;
    },
    [value, fullConfig, historyHook, toast]
  );

  /**
   * 减少计数器
   */
  const decrement = useCallback(
    (step?: number): boolean => {
      const stepValue = step ?? fullConfig.defaultStep;

      // 验证步进值
      const stepError = validateStep(stepValue);
      if (stepError) {
        toast.error(stepError.message);
        return false;
      }

      // 验证当前值
      const valueErrors = validateCounterValue(value, fullConfig);
      if (valueErrors.length > 0) {
        valueErrors.forEach((err) => toast.error(err.message));
        return false;
      }

      // 计算新值
      const newValue = safeDecrement(value, stepValue, fullConfig);
      if (newValue === null) {
        toast.warning(`已达最小值 ${fullConfig.minValue}`);
        return false;
      }

      // 更新状态
      const previousValue = value;
      setValueState(newValue);
      stateIdRef.current = generateId();

      // 记录历史
      historyHook.addRecord(previousValue, newValue, 'decrement');

      // 更新同步状态
      setSyncStatus((prev) => ({
        ...prev,
        pendingChanges: prev.pendingChanges + 1,
        lastSyncTime: prev.isOnline ? Date.now() : prev.lastSyncTime,
      }));

      return true;
    },
    [value, fullConfig, historyHook, toast]
  );

  /**
   * 重置计数器
   */
  const reset = useCallback(() => {
    const previousValue = value;
    setValueState(0);
    stateIdRef.current = generateId();
    historyHook.addRecord(previousValue, 0, 'reset');
    toast.success('计数器已重置');
  }, [value, historyHook, toast]);

  /**
   * 设置计数器值
   */
  const setValue = useCallback(
    (newValue: number): boolean => {
      // 验证新值
      const errors = validateCounterValue(newValue, fullConfig);
      if (errors.length > 0) {
        errors.forEach((err) => toast.error(err.message));
        return false;
      }

      const previousValue = value;
      setValueState(newValue);
      stateIdRef.current = generateId();
      historyHook.addRecord(previousValue, newValue, 'reset');

      return true;
    },
    [value, fullConfig, historyHook, toast]
  );

  return {
    value,
    state: createState(),
    history: historyHook.history,
    syncStatus,
    isLoading,
    increment,
    decrement,
    reset,
    setValue,
    canIncrement,
    canDecrement,
    clearHistory: historyHook.clearHistory,
  };
}
