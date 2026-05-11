// 本地存储管理
import { CounterState, HistoryEntry, DEFAULT_CONFIG } from './types';
import { validateHistorySize } from './validators';

const STORAGE_KEY = 'counter_state';
const EXPORT_VERSION = '1.0.0';

export interface StorageData {
  value: number;
  entries: HistoryEntry[];
  lastModified: number;
}

/**
 * 保存状态到本地存储
 */
export function saveToStorage(state: CounterState): void {
  try {
    const data: StorageData = {
      value: state.value,
      entries: state.history,
      lastModified: state.lastModified,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save to storage:', error);
    throw new Error('Failed to save data locally');
  }
}

/**
 * 从本地存储加载状态
 */
export function loadFromStorage(): StorageData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StorageData;
    
    // 验证数据完整性
    if (typeof data.value !== 'number') {
      throw new Error('Invalid storage data: missing value');
    }
    
    // 限制历史记录数量
    if (data.entries && data.entries.length > DEFAULT_CONFIG.maxHistorySize) {
      data.entries = data.entries.slice(-DEFAULT_CONFIG.maxHistorySize);
    }
    
    return data;
  } catch (error) {
    console.error('Failed to load from storage:', error);
    return null;
  }
}

/**
 * 清除本地存储
 */
export function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 导出数据为 JSON
 */
export function exportToJSON(
  entries: HistoryEntry[],
  finalValue: number
): string {
  const exportData = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    entries,
    finalValue,
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * 导出数据为 CSV
 */
export function exportToCSV(entries: HistoryEntry[]): string {
  const headers = ['ID', 'Value', 'Action', 'Timestamp'];
  const rows = entries.map((entry) => [
    entry.id,
    entry.value.toString(),
    entry.action,
    new Date(entry.timestamp).toISOString(),
  ]);
  
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * 导入 JSON 数据
 */
export function importFromJSON(jsonString: string): {
  entries: HistoryEntry[];
  finalValue: number;
} | null {
  try {
    const data = JSON.parse(jsonString);
    
    if (!validateHistorySize(data.entries?.length ?? 0)) {
      throw new Error('Invalid history size in import data');
    }
    
    return {
      entries: data.entries || [],
      finalValue: data.finalValue ?? 0,
    };
  } catch (error) {
    console.error('Failed to import JSON:', error);
    return null;
  }
}

/**
 * 下载文件
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
