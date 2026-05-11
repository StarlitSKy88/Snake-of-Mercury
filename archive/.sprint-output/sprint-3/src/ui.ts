// UI 组件
import { CounterState, DEFAULT_CONFIG } from './types';
import { showSuccess, showError, showWarning, showLoading, hideToast } from './toast';
import { exportToJSON, exportToCSV, downloadFile, importFromJSON } from './storage';

let currentLoadingToastId: string | null = null;

/**
 * 创建主应用容器
 */
export function createAppContainer(): HTMLElement {
  const app = document.createElement('div');
  app.id = 'counter-app';
  app.className = 'counter-app';
  app.innerHTML = `
    <div class="counter-display">
      <span class="counter-value" id="counter-value">0</span>
    </div>
    <div class="counter-controls">
      <button class="btn btn-secondary" id="btn-decrement" aria-label="Decrease">−</button>
      <button class="btn btn-primary" id="btn-increment" aria-label="Increase">+</button>
    </div>
    <div class="counter-actions">
      <button class="btn btn-outline" id="btn-reset">Reset</button>
      <button class="btn btn-outline" id="btn-undo" disabled>Undo</button>
      <button class="btn btn-outline" id="btn-redo" disabled>Redo</button>
    </div>
    <div class="counter-info">
      <span class="sync-status" id="sync-status">Ready</span>
      <span class="last-sync" id="last-sync"></span>
    </div>
    <div class="counter-export">
      <button class="btn btn-small" id="btn-export-json">Export JSON</button>
      <button class="btn btn-small" id="btn-export-csv">Export CSV</button>
      <button class="btn btn-small" id="btn-import">Import</button>
      <input type="file" id="file-input" accept=".json,.csv" style="display:none">
    </div>
    <div class="shortcut-hint">
      <p>Keyboard: +/- or ↑/↓ to change, R to reset, Ctrl+Z undo, Ctrl+Y redo, Esc to cancel</p>
    </div>
  `;
  return app;
}

/**
 * 更新显示值
 */
export function updateDisplay(state: CounterState): void {
  const valueEl = document.getElementById('counter-value');
  if (valueEl) {
    valueEl.textContent = state.value.toString();
    valueEl.classList.add('value-changed');
    setTimeout(() => valueEl.classList.remove('value-changed'), 200);
  }
}

/**
 * 更新按钮状态
 */
export function updateButtonStates(
  canUndo: boolean,
  canRedo: boolean
): void {
  const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
  const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
  
  if (undoBtn) undoBtn.disabled = !canUndo;
  if (redoBtn) redoBtn.disabled = !canRedo;
}

/**
 * 更新同步状态
 */
export function updateSyncStatus(
  status: CounterState['syncStatus'],
  lastSyncTime?: number
): void {
  const syncEl = document.getElementById('sync-status');
  const lastSyncEl = document.getElementById('last-sync');
  
  if (syncEl) {
    syncEl.textContent = status === 'synced' 
      ? 'Synced' 
      : status === 'pending' 
        ? 'Pending...' 
        : 'Sync Error';
    syncEl.className = `sync-status sync-${status}`;
  }
  
  if (lastSyncEl && lastSyncTime) {
    const date = new Date(lastSyncTime);
    lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
  }
}

/**
 * 显示加载状态
 */
export function showAppLoading(message: string = 'Processing...'): void {
  if (currentLoadingToastId) {
    hideToast(currentLoadingToastId);
  }
  currentLoadingToastId = showLoading(message);
}

/**
 * 隐藏加载状态
 */
export function hideAppLoading(): void {
  if (currentLoadingToastId) {
    hideToast(currentLoadingToastId);
    currentLoadingToastId = null;
  }
}

/**
 * 处理导出 JSON
 */
export function handleExportJSON(state: CounterState): void {
  try {
    const json = exportToJSON(state.history, state.value);
    const filename = `counter-export-${Date.now()}.json`;
    downloadFile(json, filename, 'application/json');
    showSuccess('Exported to JSON successfully');
  } catch (error) {
    showError('Failed to export JSON');
  }
}

/**
 * 处理导出 CSV
 */
export function handleExportCSV(state: CounterState): void {
  try {
    const csv = exportToCSV(state.history);
    const filename = `counter-export-${Date.now()}.csv`;
    downloadFile(csv, filename, 'text/csv');
    showSuccess('Exported to CSV successfully');
  } catch (error) {
    showError('Failed to export CSV');
  }
}

/**
 * 验证文件大小
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function isValidFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE;
}

/**
 * 处理文件导入
 */
export function handleImport(
  file: File,
  onSuccess: (entries: unknown[], finalValue: number) => void,
  onError: (message: string) => void
): void {
  if (!isValidFileSize(file)) {
    onError(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    return;
  }
  
  showAppLoading('Importing...');
  
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const result = importFromJSON(content);
      
      if (result) {
        showSuccess('Imported successfully');
        onSuccess(result.entries, result.finalValue);
      } else {
        showError('Invalid file format');
        onError('Invalid file format');
      }
    } catch (error) {
      showError('Failed to read file');
      onError('Failed to read file');
    } finally {
      hideAppLoading();
    }
  };
  
  reader.onerror = () => {
    hideAppLoading();
    showError('Failed to read file');
    onError('Failed to read file');
  };
  
  reader.readAsText(file);
}

/**
 * 设置文件输入监听
 */
export function setupFileInput(
  onImport: (file: File) => void
): () => void {
  const input = document.getElementById('file-input') as HTMLInputElement;
  if (!input) return () => {};
  
  const handler = () => {
    const file = input.files?.[0];
    if (file) {
      onImport(file);
      input.value = ''; // 重置以允许选择相同文件
    }
  };
  
  input.addEventListener('change', handler);
  return () => input.removeEventListener('change', handler);
}
