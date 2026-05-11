/**
 * Sprint 2 - 数据持久化与边界处理
 * 包含：localStorage持久化、输入验证、Toast通知、键盘导航、导出功能
 */

import { StorageManager } from './storage';
import { CounterLogic, ValidationError } from './counterLogic';
import { SyncManager } from './syncManager';
import { ToastManager } from './toast';

export interface CounterState {
  value: number;
  lastModified: string;
  syncStatus: 'synced' | 'pending' | 'error';
}

export interface AppConfig {
  maxValue: number;
  minValue: number;
  step: number;
  storageKey: string;
}

const DEFAULT_CONFIG: AppConfig = {
  maxValue: 999999,
  minValue: 0,
  step: 1,
  storageKey: 'counter-state'
};

export class CounterApp {
  private storage: StorageManager;
  private logic: CounterLogic;
  private sync: SyncManager;
  private toast: ToastManager;
  private config: AppConfig;
  private state: CounterState;

  private elements: {
    counter: HTMLElement | null;
    incrementBtn: HTMLElement | null;
    decrementBtn: HTMLElement | null;
    resetBtn: HTMLElement | null;
    exportCsvBtn: HTMLElement | null;
    exportJsonBtn: HTMLElement | null;
    syncStatus: HTMLElement | null;
    lastSync: HTMLElement | null;
    loadingOverlay: HTMLElement | null;
  };

  constructor(config: Partial<AppConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = new StorageManager(this.config.storageKey);
    this.logic = new CounterLogic(this.config.maxValue, this.config.minValue);
    this.sync = new SyncManager();
    this.toast = new ToastManager();
    
    this.state = {
      value: 0,
      lastModified: new Date().toISOString(),
      syncStatus: 'synced'
    };

    this.elements = {
      counter: null,
      incrementBtn: null,
      decrementBtn: null,
      resetBtn: null,
      exportCsvBtn: null,
      exportJsonBtn: null,
      syncStatus: null,
      lastSync: null,
      loadingOverlay: null
    };

    this.init();
  }

  private init(): void {
    this.loadState();
    this.bindElements();
    this.bindEvents();
    this.render();
    this.setupKeyboardNav();
    this.updateSyncStatus();
  }

  private bindElements(): void {
    this.elements.counter = document.getElementById('counter');
    this.elements.incrementBtn = document.getElementById('increment');
    this.elements.decrementBtn = document.getElementById('decrement');
    this.elements.resetBtn = document.getElementById('reset');
    this.elements.exportCsvBtn = document.getElementById('export-csv');
    this.elements.exportJsonBtn = document.getElementById('export-json');
    this.elements.syncStatus = document.getElementById('sync-status');
    this.elements.lastSync = document.getElementById('last-sync');
    this.elements.loadingOverlay = document.getElementById('loading-overlay');
  }

  private bindEvents(): void {
    this.elements.incrementBtn?.addEventListener('click', () => this.increment());
    this.elements.decrementBtn?.addEventListener('click', () => this.decrement());
    this.elements.resetBtn?.addEventListener('click', () => this.reset());
    this.elements.exportCsvBtn?.addEventListener('click', () => this.exportCsv());
    this.elements.exportJsonBtn?.addEventListener('click', () => this.exportJson());

    this.sync.onStatusChange((status) => {
      this.updateSyncUI(status);
    });
  }

  private loadState(): void {
    try {
      const saved = this.storage.load();
      if (saved) {
        this.state = saved;
      }
    } catch (error) {
      console.error('Failed to load state:', error);
      this.state = { value: 0, lastModified: new Date().toISOString(), syncStatus: 'synced' };
    }
  }

  private saveState(): void {
    try {
      this.state.lastModified = new Date().toISOString();
      this.storage.save(this.state);
      this.sync.queueSync(this.state);
    } catch (error) {
      console.error('Failed to save state:', error);
      this.toast.show('保存失败，请重试', 'error');
    }
  }

  private render(): void {
    if (this.elements.counter) {
      this.elements.counter.textContent = this.state.value.toString();
    }
  }

  private increment(): void {
    try {
      this.showLoading(true);
      const newValue = this.logic.increment(this.state.value);
      this.state.value = newValue;
      this.state.syncStatus = 'pending';
      this.saveState();
      this.render();
      this.toast.show(`已增加至 ${newValue}`, 'success');
    } catch (error) {
      if (error instanceof ValidationError) {
        this.toast.show(error.message, 'warning');
      } else {
        this.toast.show('操作失败', 'error');
      }
    } finally {
      this.showLoading(false);
    }
  }

  private decrement(): void {
    try {
      this.showLoading(true);
      const newValue = this.logic.decrement(this.state.value);
      this.state.value = newValue;
      this.state.syncStatus = 'pending';
      this.saveState();
      this.render();
      this.toast.show(`已减少至 ${newValue}`, 'success');
    } catch (error) {
      if (error instanceof ValidationError) {
        this.toast.show(error.message, 'warning');
      } else {
        this.toast.show('操作失败', 'error');
      }
    } finally {
      this.showLoading(false);
    }
  }

  private reset(): void {
    if (confirm('确定要重置计数器吗？')) {
      try {
        this.state.value = 0;
        this.state.syncStatus = 'pending';
        this.saveState();
        this.render();
        this.toast.show('计数器已重置', 'success');
      } catch (error) {
        this.toast.show('重置失败', 'error');
      }
    }
  }

  private exportCsv(): void {
    try {
      const history = this.storage.getHistory();
      const csv = this.generateCsv(history);
      this.downloadFile(csv, 'counter-export.csv', 'text/csv');
      this.toast.show('CSV 导出成功', 'success');
    } catch (error) {
      this.toast.show('CSV 导出失败', 'error');
    }
  }

  private exportJson(): void {
    try {
      const history = this.storage.getHistory();
      const json = JSON.stringify(history, null, 2);
      this.downloadFile(json, 'counter-export.json', 'application/json');
      this.toast.show('JSON 导出成功', 'success');
    } catch (error) {
      this.toast.show('JSON 导出失败', 'error');
    }
  }

  private generateCsv(data: CounterState[]): string {
    const headers = 'Value,Last Modified,Sync Status\n';
    const rows = data.map(d => `${d.value},${d.lastModified},${d.syncStatus}`).join('\n');
    return headers + rows;
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
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

  private showLoading(show: boolean): void {
    if (this.elements.loadingOverlay) {
      this.elements.loadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }

  private updateSyncUI(status: string): void {
    if (this.elements.syncStatus) {
      this.elements.syncStatus.textContent = this.getSyncStatusText(status);
      this.elements.syncStatus.className = `sync-status sync-${status}`;
    }
    if (this.elements.lastSync) {
      this.elements.lastSync.textContent = `上次同步: ${new Date().toLocaleTimeString()}`;
    }
  }

  private getSyncStatusText(status: string): string {
    switch (status) {
      case 'synced': return '已同步';
      case 'pending': return '同步中...';
      case 'error': return '同步失败';
      default: return '未知状态';
    }
  }

  private updateSyncStatus(): void {
    this.updateSyncUI(this.state.syncStatus);
  }

  private setupKeyboardNav(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      switch (e.key) {
        case '+':
        case '=':
        case 'ArrowUp':
          e.preventDefault();
          this.increment();
          break;
        case '-':
        case 'ArrowDown':
          e.preventDefault();
          this.decrement();
          break;
        case 'r':
        case 'R':
          if (!e.ctrlKey && !e.metaKey) {
            this.reset();
          }
          break;
        case 'Escape':
          this.toast.hideAll();
          break;
      }
    });
  }

  public getState(): CounterState {
    return { ...this.state };
  }

  public destroy(): void {
    this.sync.destroy();
    this.toast.hideAll();
  }
}

// 初始化应用
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new CounterApp();
    (window as any).counterApp = app;
  });
}
