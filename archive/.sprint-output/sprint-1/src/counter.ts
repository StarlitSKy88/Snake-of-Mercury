/**
 * 计数器核心逻辑
 * 实现 +1/-1/Reset 操作，包含完整的输入验证和边界检查
 */

import { randomUUID } from 'crypto';

// 常量定义
const MAX_VALUE = 999999;
const MIN_VALUE = 0;
const MAX_HISTORY = 1000;

// 历史记录项接口
interface HistoryItem {
  id: string;
  timestamp: number;
  action: 'increment' | 'decrement' | 'reset' | 'set';
  previousValue: number;
  newValue: number;
}

// Toast 消息类型
type ToastType = 'success' | 'error' | 'warning';

// 计数器状态接口
interface CounterState {
  value: number;
  history: HistoryItem[];
  lastSyncTime: number | null;
  isLoading: boolean;
}

// 全局状态
let state: CounterState = {
  value: 0,
  history: [],
  lastSyncTime: null,
  isLoading: false,
};

// 回调函数类型
type StateChangeCallback = (state: CounterState) => void;
type ToastCallback = (message: string, type: ToastType) => void;

let onStateChange: StateChangeCallback | null = null;
let onToast: ToastCallback | null = null;

/**
 * 设置状态变化回调
 */
export function setStateChangeCallback(callback: StateChangeCallback | null): void {
  onStateChange = callback;
}

/**
 * 设置 Toast 回调
 */
export function setToastCallback(callback: ToastCallback | null): void {
  onToast = callback;
}

/**
 * 显示 Toast 通知
 */
function showToast(message: string, type: ToastType): void {
  if (onToast) {
    onToast(message, type);
  }
}

/**
 * 验证数值是否有效
 */
function validateValue(value: number): void {
  if (typeof value !== 'number') {
    throw new Error('Invalid type: value must be a number');
  }
  if (!Number.isFinite(value)) {
    throw new Error('Invalid value: must be finite number');
  }
  if (value < MIN_VALUE) {
    throw new Error('Invalid value: cannot be negative');
  }
  if (value > MAX_VALUE) {
    throw new Error(`Invalid value: cannot exceed ${MAX_VALUE}`);
  }
}

/**
 * 添加历史记录（LRU 限制）
 */
function addHistory(action: HistoryItem['action'], previousValue: number, newValue: number): void {
  const item: HistoryItem = {
    id: randomUUID(),
    timestamp: Date.now(),
    action,
    previousValue,
    newValue,
  };

  state.history.unshift(item);

  // LRU 容量限制
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(0, MAX_HISTORY);
  }
}

/**
 * 触发状态变化通知
 */
function notifyStateChange(): void {
  if (onStateChange) {
    onStateChange({ ...state });
  }
}

/**
 * 获取当前计数值
 */
export function getValue(): number {
  return state.value;
}

/**
 * 获取计数器状态
 */
export function getState(): CounterState {
  return { ...state };
}

/**
 * 设置 Loading 状态
 */
export function setLoading(loading: boolean): void {
  state.isLoading = loading;
  notifyStateChange();
}

/**
 * 获取 Loading 状态
 */
export function isLoading(): boolean {
  return state.isLoading;
}

/**
 * 增加计数
 */
export function increment(step: number = 1): number {
  // 类型验证
  if (typeof step !== 'number') {
    throw new Error('Invalid type: step must be a number');
  }
  if (!Number.isFinite(step)) {
    throw new Error('Invalid step: must be finite number');
  }
  if (step <= 0) {
    throw new Error('Invalid step: must be positive');
  }

  const previousValue = state.value;
  const newValue = Math.min(state.value + step, MAX_VALUE);

  if (newValue === previousValue && state.value >= MAX_VALUE) {
    showToast(`Maximum value ${MAX_VALUE} reached`, 'warning');
    return state.value;
  }

  state.value = newValue;
  addHistory('increment', previousValue, newValue);
  showToast(`Incremented to ${newValue}`, 'success');
  notifyStateChange();

  return newValue;
}

/**
 * 减少计数
 */
export function decrement(step: number = 1): number {
  // 类型验证
  if (typeof step !== 'number') {
    throw new Error('Invalid type: step must be a number');
  }
  if (!Number.isFinite(step)) {
    throw new Error('Invalid step: must be finite number');
  }
  if (step <= 0) {
    throw new Error('Invalid step: must be positive');
  }

  const previousValue = state.value;
  const newValue = Math.max(state.value - step, MIN_VALUE);

  if (newValue === previousValue && state.value <= MIN_VALUE) {
    showToast('Minimum value 0 reached', 'warning');
    return state.value;
  }

  state.value = newValue;
  addHistory('decrement', previousValue, newValue);
  showToast(`Decremented to ${newValue}`, 'success');
  notifyStateChange();

  return newValue;
}

/**
 * 重置计数
 */
export function reset(): void {
  const previousValue = state.value;
  state.value = 0;
  addHistory('reset', previousValue, 0);
  showToast('Counter reset to 0', 'success');
  notifyStateChange();
}

/**
 * 设置计数值
 */
export function setValue(value: number): number {
  validateValue(value);
  const previousValue = state.value;
  state.value = value;
  addHistory('set', previousValue, value);
  showToast(`Set to ${value}`, 'success');
  notifyStateChange();
  return value;
}

/**
 * 导出历史记录为 JSON
 */
export function exportToJSON(): string {
  const data = {
    currentValue: state.value,
    history: state.history,
    exportedAt: new Date().toISOString(),
  };
  showToast('Exported to JSON', 'success');
  return JSON.stringify(data, null, 2);
}

/**
 * 导出历史记录为 CSV
 */
export function exportToCSV(): string {
  const headers = ['ID', 'Timestamp', 'Action', 'Previous Value', 'New Value'];
  const rows = state.history.map(item => [
    item.id,
    new Date(item.timestamp).toISOString(),
    item.action,
    item.previousValue.toString(),
    item.newValue.toString(),
  ]);

  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  showToast('Exported to CSV', 'success');
  return csv;
}

/**
 * 获取历史记录
 */
export function getHistory(): HistoryItem[] {
  return [...state.history];
}

/**
 * 清除历史记录
 */
export function clearHistory(): void {
  state.history = [];
  showToast('History cleared', 'success');
  notifyStateChange();
}

/**
 * 下载文本文件
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${filename}`, 'success');
}

// 键盘快捷键处理
export function initKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // 忽略输入框中的按键
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      return;
    }

    switch (e.key) {
      case '+':
      case '=':
      case 'ArrowUp':
        e.preventDefault();
        increment();
        break;
      case '-':
      case 'ArrowDown':
        e.preventDefault();
        decrement();
        break;
      case 'r':
      case 'R':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          reset();
        }
        break;
      case 'Escape':
        // 取消操作（目前无操作可取消）
        break;
    }
  });
}

// 初始化
export function init(): void {
  state.isLoading = true;
  notifyStateChange();

  // 模拟初始化延迟
  setTimeout(() => {
    state.isLoading = false;
    state.lastSyncTime = Date.now();
    notifyStateChange();
    showToast('Counter initialized', 'success');
  }, 500);
}

// 重置状态（用于测试）
export function resetState(): void {
  state = {
    value: 0,
    history: [],
    lastSyncTime: null,
    isLoading: false,
  };
}
