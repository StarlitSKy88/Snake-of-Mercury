// 类型定义
export interface CounterState {
  value: number;
  history: HistoryEntry[];
  future: HistoryEntry[];
  lastModified: number;
  syncStatus: 'synced' | 'pending' | 'error';
}

export interface HistoryEntry {
  id: string;
  value: number;
  timestamp: number;
  action: 'increment' | 'decrement' | 'reset' | 'set';
}

export interface ExportData {
  version: string;
  exportedAt: number;
  entries: HistoryEntry[];
  finalValue: number;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning';
  duration: number;
}

export interface AppConfig {
  maxValue: number;
  minValue: number;
  maxHistorySize: number;
  toastDuration: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  maxValue: 999999,
  minValue: 0,
  maxHistorySize: 1000,
  toastDuration: 3000,
};
