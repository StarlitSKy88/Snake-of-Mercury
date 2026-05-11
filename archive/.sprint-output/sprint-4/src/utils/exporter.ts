/**
 * 数据导出工具
 * 支持 CSV 和 JSON 格式导出
 */

import { HistoryItem, ExportConfig, ExportFormat } from '../types';

/**
 * 将历史记录转换为 CSV 格式
 * @param history - 历史记录数组
 * @param includeMetadata - 是否包含元数据
 * @returns CSV 字符串
 */
export function toCSV(history: HistoryItem[], includeMetadata: boolean = true): string {
  const lines: string[] = [];

  // CSV 头部
  if (includeMetadata) {
    lines.push('ID,Previous Value,New Value,Timestamp,Action');
  }

  // 数据行
  for (const item of history) {
    const timestamp = new Date(item.timestamp).toISOString();
    if (includeMetadata) {
      lines.push(`${item.id},${item.previousValue},${item.newValue},${timestamp},${item.action}`);
    } else {
      lines.push(`${item.previousValue},${item.newValue},${item.action}`);
    }
  }

  return lines.join('\n');
}

/**
 * 将历史记录转换为 JSON 格式
 * @param history - 历史记录数组
 * @param includeMetadata - 是否包含元数据
 * @returns JSON 字符串
 */
export function toJSON(history: HistoryItem[], includeMetadata: boolean = true): string {
  const data = includeMetadata
    ? {
        exportedAt: new Date().toISOString(),
        totalRecords: history.length,
        records: history,
      }
    : history;

  return JSON.stringify(data, null, 2);
}

/**
 * 创建下载链接并触发下载
 * @param content - 文件内容
 * @param filename - 文件名
 * @param mimeType - MIME 类型
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  // 清理
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * 导出历史记录
 * @param history - 历史记录数组
 * @param config - 导出配置
 */
export function exportHistory(history: HistoryItem[], config: ExportConfig): void {
  const { format, includeHistory, includeMetadata } = config;

  // 如果不包含历史，使用空数组
  const data = includeHistory ? history : [];

  let content: string;
  let filename: string;
  let mimeType: string;

  if (format === 'csv') {
    content = toCSV(data, includeMetadata);
    filename = `counter-history-${Date.now()}.csv`;
    mimeType = 'text/csv;charset=utf-8;';
  } else {
    content = toJSON(data, includeMetadata);
    filename = `counter-history-${Date.now()}.json`;
    mimeType = 'application/json';
  }

  downloadFile(content, filename, mimeType);
}

/**
 * 导出计数器快照
 * @param value - 当前计数值
 * @param history - 历史记录
 * @param format - 导出格式
 */
export function exportSnapshot(
  value: number,
  history: HistoryItem[],
  format: ExportFormat = 'json'
): void {
  const snapshot = {
    currentValue: value,
    exportedAt: new Date().toISOString(),
    historyCount: history.length,
    history: history.slice(-100), // 限制最近 100 条
  };

  let content: string;
  let filename: string;
  let mimeType: string;

  if (format === 'csv') {
    content = toCSV(snapshot.history, true);
    filename = `counter-snapshot-${Date.now()}.csv`;
    mimeType = 'text/csv;charset=utf-8;';
  } else {
    content = JSON.stringify(snapshot, null, 2);
    filename = `counter-snapshot-${Date.now()}.json`;
    mimeType = 'application/json';
  }

  downloadFile(content, filename, mimeType);
}
