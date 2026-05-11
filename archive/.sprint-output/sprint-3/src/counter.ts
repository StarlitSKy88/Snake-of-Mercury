// 核心计数器逻辑
import {
  CounterState,
  HistoryEntry,
  DEFAULT_CONFIG,
  ExportData,
} from './types';
import { validateCounterValue, validateIncrementValue, validateSetValue, validateHistorySize } from './validators';
import { generateSecureId } from './crypto';
import { saveToStorage, loadFromStorage } from './storage';

/**
 * 创建初始状态
 */
export function createInitialState(): CounterState {
  return {
    value: 0,
    history: [],
    future: [],
    lastModified: Date.now(),
    syncStatus: 'synced',
  };
}

/**
 * 加载状态（带离线支持）
 */
export function loadState(): CounterState {
  const saved = loadFromStorage();
  if (saved) {
    return {
      value: validateCounterValue(saved.value),
      history: saved.entries || [],
      future: [],
      lastModified: saved.lastModified || Date.now(),
      syncStatus: 'synced',
    };
  }
  return createInitialState();
}

/**
 * 增加计数
 */
export function increment(
  state: CounterState,
  step: number = 1,
  config = DEFAULT_CONFIG
): CounterState {
  const validStep = validateIncrementValue(step);
  const newValue = validateCounterValue(state.value + validStep, config);
  
  const entry: HistoryEntry = {
    id: generateSecureId(),
    value: newValue,
    timestamp: Date.now(),
    action: 'increment',
  };
  
  const newState: CounterState = {
    value: newValue,
    history: [...state.history, entry].slice(-config.maxHistorySize),
    future: [],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 减少计数
 */
export function decrement(
  state: CounterState,
  step: number = 1,
  config = DEFAULT_CONFIG
): CounterState {
  const validStep = validateIncrementValue(step);
  const newValue = validateCounterValue(state.value - validStep, config);
  
  const entry: HistoryEntry = {
    id: generateSecureId(),
    value: newValue,
    timestamp: Date.now(),
    action: 'decrement',
  };
  
  const newState: CounterState = {
    value: newValue,
    history: [...state.history, entry].slice(-config.maxHistorySize),
    future: [],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 重置计数
 */
export function reset(
  state: CounterState,
  config = DEFAULT_CONFIG
): CounterState {
  const entry: HistoryEntry = {
    id: generateSecureId(),
    value: 0,
    timestamp: Date.now(),
    action: 'reset',
  };
  
  const newState: CounterState = {
    value: 0,
    history: [...state.history, entry].slice(-config.maxHistorySize),
    future: [],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 设置特定值
 */
export function setValue(
  state: CounterState,
  value: number,
  config = DEFAULT_CONFIG
): CounterState {
  const validValue = validateSetValue(value, config);
  
  const entry: HistoryEntry = {
    id: generateSecureId(),
    value: validValue,
    timestamp: Date.now(),
    action: 'set',
  };
  
  const newState: CounterState = {
    value: validValue,
    history: [...state.history, entry].slice(-config.maxHistorySize),
    future: [],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 撤销操作
 */
export function undo(state: CounterState): CounterState {
  if (state.history.length === 0) {
    return state;
  }
  
  const newHistory = [...state.history];
  const lastEntry = newHistory.pop()!;
  
  // 获取撤销前的值
  const previousValue =
    newHistory.length > 0 ? newHistory[newHistory.length - 1].value : 0;
  
  const newState: CounterState = {
    value: previousValue,
    history: newHistory,
    future: [lastEntry, ...state.future],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 重做操作
 */
export function redo(state: CounterState): CounterState {
  if (state.future.length === 0) {
    return state;
  }
  
  const newFuture = [...state.future];
  const redoEntry = newFuture.shift()!;
  
  const newState: CounterState = {
    value: redoEntry.value,
    history: [...state.history, redoEntry],
    future: newFuture,
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 检查是否可以撤销
 */
export function canUndo(state: CounterState): boolean {
  return state.history.length > 0;
}

/**
 * 检查是否可以重做
 */
export function canRedo(state: CounterState): boolean {
  return state.future.length > 0;
}

/**
 * 清除历史记录
 */
export function clearHistory(state: CounterState): CounterState {
  const newState: CounterState = {
    ...state,
    history: [],
    future: [],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}

/**
 * 导入数据
 */
export function importData(
  state: CounterState,
  entries: HistoryEntry[],
  finalValue: number,
  config = DEFAULT_CONFIG
): CounterState {
  validateHistorySize(entries.length);
  const validValue = validateCounterValue(finalValue, config);
  
  const entry: HistoryEntry = {
    id: generateSecureId(),
    value: validValue,
    timestamp: Date.now(),
    action: 'set',
  };
  
  const newState: CounterState = {
    value: validValue,
    history: [...entries, entry].slice(-config.maxHistorySize),
    future: [],
    lastModified: Date.now(),
    syncStatus: 'pending',
  };
  
  saveToStorage(newState);
  return newState;
}
