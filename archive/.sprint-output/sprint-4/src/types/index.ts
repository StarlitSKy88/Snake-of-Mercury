/**
 * 计数器相关类型定义
 * @packageDocumentation
 */

/** 计数器状态 */
export interface CounterState {
  value: number;
  id: string;
  timestamp: number;
  step: number;
}

/** Toast 通知类型 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** Toast 消息 */
export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

/** 历史记录项 */
export interface HistoryItem {
  id: string;
  previousValue: number;
  newValue: number;
  timestamp: number;
  action: 'increment' | 'decrement' | 'reset';
}

/** 导出格式 */
export type ExportFormat = 'csv' | 'json';

/** 验证错误 */
export interface ValidationError {
  field: string;
  message: string;
  code: 'INVALID_TYPE' | 'NOT_FINITE' | 'NEGATIVE' | 'OVERFLOW' | 'UNDERFLOW';
}

/** 同步状态 */
export interface SyncStatus {
  isOnline: boolean;
  lastSyncTime: number | null;
  pendingChanges: number;
  isSyncing: boolean;
}

/** 导出配置 */
export interface ExportConfig {
  format: ExportFormat;
  includeHistory: boolean;
  includeMetadata: boolean;
}

/** 计数器配置 */
export interface CounterConfig {
  minValue: number;
  maxValue: number;
  defaultStep: number;
  maxHistorySize: number;
}
