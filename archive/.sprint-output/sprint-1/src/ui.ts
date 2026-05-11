/**
 * 计数器 UI 界面
 * 提供完整的用户交互界面，包括 Toast、Loading 状态、键盘导航
 */

// 导入 counter 模块的函数（通过全局 window 对象访问）
declare global {
  interface Window {
    counter: {
      getValue: () => number;
      increment: (step?: number) => number;
      decrement: (step?: number) => number;
      reset: () => void;
      setValue: (value: number) => number;
      exportToJSON: () => string;
      exportToCSV: () => string;
      downloadFile: (content: string, filename: string, mimeType: string) => void;
      isLoading: () => boolean;
      setStateChangeCallback: (callback: ((state: any) => void) | null) => void;
      setToastCallback: (callback: ((message: string, type: 'success' | 'error' | 'warning') => void) | null) => void;
      initKeyboardShortcuts: () => void;
      init: () => void;
      resetState: () => void;
    };
  }
}

// Toast 容器管理
class ToastManager {
  private container: HTMLElement | null = null;

  constructor() {
    this.createContainer();
  }

  private createContainer(): void {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.setAttribute('role', 'alert');
    this.container.setAttribute('aria-live', 'polite');

    const style = document.createElement('style');
    style.textContent = `
      .toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }

      .toast {
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: toast-slide-in 0.3s ease-out;
        pointer-events: auto;
        min-width: 200px;
        max-width: 350px;
      }

      .toast-success {
        background-color: #10b981;
        color: white;
      }

      .toast-error {
        background-color: #ef4444;
        color: white;
      }

      .toast-warning {
        background-color: #f59e0b;
        color: white;
      }

      @keyframes toast-slide-in {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes toast-slide-out {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(this.container);
  }

  show(message: string, type: 'success' | 'error' | 'warning'): void {
    if (!this.container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.container.appendChild(toast);

    // 自动移除
    setTimeout(() => {
      toast.style.animation = 'toast-slide-out 0.3s ease-out';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }
}

// Loading 指示器管理
class LoadingManager {
  private overlay: HTMLElement | null = null;

  constructor() {
    this.createOverlay();
  }

  private createOverlay(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'loading-overlay';
    this.overlay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s, visibility 0.3s;
      }

      .loading-overlay.active {
        opacity: 1;
        visibility: visible;
      }

      .loading-spinner {
        text-align: center;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .spinner {
        width: 48px;
        height: 48px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 16px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(this.overlay);
  }

  show(): void {
    if (this.overlay) {
      this.overlay.classList.add('active');
    }
  }

  hide(): void {
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
  }
}

// 主题管理器
class ThemeManager {
  private currentTheme: 'light' | 'dark' = 'light';

  toggle(): void {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.apply();
  }

  private apply(): void {
    document.documentElement.setAttribute('data-theme', this.currentTheme);

    const style = document.createElement('style');
    style.id = 'theme-style';
    style.textContent = `
      [data-theme="dark"] {
        --bg-primary: #1a1a2e;
        --bg-secondary: #16213e;
        --text-primary: #eaeaea;
        --text-secondary: #a0a0a0;
        --accent: #0f3460;
        --button-bg: #e94560;
      }
    `;
    const existingStyle = document.getElementById('theme-style');
    if (existingStyle) {
      existingStyle.replaceWith(style);
    } else {
      document.head.appendChild(style);
    }
  }
}

// 主 UI 类
class CounterUI {
  private toastManager: ToastManager;
  private loadingManager: LoadingManager;
  private themeManager: ThemeManager;
  private displayElement: HTMLElement | null = null;

  constructor() {
    this.toastManager = new ToastManager();
    this.loadingManager = new LoadingManager();
    this.themeManager = new ThemeManager();
  }

  /**
   * 创建完整 UI
   */
  create(): void {
    this.injectStyles();
    this.createContainer();
    this.setupCallbacks();
    this.updateDisplay();
  }

  /**
   * 注入全局样式
   */
  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      :root {
        --bg-primary: #f8fafc;
        --bg-secondary: #ffffff;
        --text-primary: #1e293b;
        --text-secondary: #64748b;
        --accent: #3b82f6;
        --button-bg: #3b82f6;
        --button-hover: #2563eb;
        --border-color: #e2e8f0;
        --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        background-color: var(--bg-primary);
        color: var(--text-primary);
        min-height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .counter-container {
        background: var(--bg-secondary);
        border-radius: 16px;
        box-shadow: var(--shadow);
        padding: 40px;
        min-width: 320px;
        text-align: center;
      }

      .counter-title {
        font-size: 24px;
        font-weight: 700;
        margin-bottom: 24px;
        color: var(--text-primary);
      }

      .counter-display {
        font-size: 72px;
        font-weight: 800;
        color: var(--accent);
        margin: 24px 0;
        font-variant-numeric: tabular-nums;
        user-select: none;
      }

      .counter-display.error {
        color: #ef4444;
        animation: shake 0.5s ease-in-out;
      }

      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      .counter-buttons {
        display: flex;
        gap: 12px;
        justify-content: center;
        margin: 24px 0;
        flex-wrap: wrap;
      }

      .btn {
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .btn:hover {
        transform: translateY(-2px);
      }

      .btn:active {
        transform: translateY(0);
      }

      .btn-primary {
        background-color: var(--button-bg);
        color: white;
      }

      .btn-primary:hover {
        background-color: var(--button-hover);
      }

      .btn-success {
        background-color: #10b981;
        color: white;
      }

      .btn-success:hover {
        background-color: #059669;
      }

      .btn-danger {
        background-color: #ef4444;
        color: white;
      }

      .btn-danger:hover {
        background-color: #dc2626;
      }

      .btn-secondary {
        background-color: #6b7280;
        color: white;
      }

      .btn-secondary:hover {
        background-color: #4b5563;
      }

      .btn-icon {
        width: 18px;
        height: 18px;
      }

      .counter-actions {
        display: flex;
        gap: 8px;
        justify-content: center;
        margin-top: 16px;
        flex-wrap: wrap;
      }

      .btn-small {
        padding: 8px 16px;
        font-size: 12px;
      }

      .shortcut-hint {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: 16px;
      }

      .shortcut-hint kbd {
        background: var(--bg-primary);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 11px;
        border: 1px solid var(--border-color);
      }

      .sync-status {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 创建容器
   */
  private createContainer(): void {
    const container = document.createElement('div');
    container.className = 'counter-container';
    container.innerHTML = `
      <h1 class="counter-title">Counter</h1>
      <div class="counter-display" id="counter-display">0</div>
      <div class="counter-buttons">
        <button class="btn btn-primary" id="btn-decrement" aria-label="Decrease">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Decrease
        </button>
        <button class="btn btn-success" id="btn-increment" aria-label="Increase">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Increase
        </button>
      </div>
      <div class="counter-actions">
        <button class="btn btn-danger btn-small" id="btn-reset">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
          Reset (R)
        </button>
        <button class="btn btn-secondary btn-small" id="btn-export-json">Export JSON</button>
        <button class="btn btn-secondary btn-small" id="btn-export-csv">Export CSV</button>
        <button class="btn btn-secondary btn-small" id="btn-toggle-theme">Toggle Theme</button>
      </div>
      <p class="shortcut-hint">
        Shortcuts: <kbd>+</kbd>/<kbd>-</kbd> or <kbd>↑</kbd>/<kbd>↓</kbd> to adjust,
        <kbd>R</kbd> to reset, <kbd>Esc</kbd> to cancel
      </p>
      <p class="sync-status" id="sync-status">Ready</p>
    `;

    document.body.innerHTML = '';
    document.body.appendChild(container);

    // 缓存 display 元素
    this.displayElement = document.getElementById('counter-display');

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    document.getElementById('btn-increment')?.addEventListener('click', () => {
      if (window.counter) {
        window.counter.increment();
      }
    });

    document.getElementById('btn-decrement')?.addEventListener('click', () => {
      if (window.counter) {
        window.counter.decrement();
      }
    });

    document.getElementById('btn-reset')?.addEventListener('click', () => {
      if (window.counter) {
        window.counter.reset();
      }
    });

    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      if (window.counter) {
        const json = window.counter.exportToJSON();
        window.counter.downloadFile(json, 'counter-data.json', 'application/json');
      }
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      if (window.counter) {
        const csv = window.counter.exportToCSV();
        window.counter.downloadFile(csv, 'counter-data.csv', 'text/csv');
      }
    });

    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
      this.themeManager.toggle();
    });
  }

  /**
   * 设置回调
   */
  private setupCallbacks(): void {
    if (!window.counter) return;

    // 状态变化回调
    window.counter.setStateChangeCallback((state) => {
      this.updateDisplay();
      if (state.isLoading) {
        this.loadingManager.show();
      } else {
        this.loadingManager.hide();
      }
      this.updateSyncStatus(state.lastSyncTime);
    });

    // Toast 回调
    window.counter.setToastCallback((message, type) => {
      this.toastManager.show(message, type);
    });
  }

  /**
   * 更新显示
   */
  private updateDisplay(): void {
    if (!this.displayElement || !window.counter) return;

    const value = window.counter.getValue();
    this.displayElement.textContent = value.toString();

    // 添加错误动画效果
    this.displayElement.classList.remove('error');
    if (value === 0 || value >= 999999) {
      this.displayElement.classList.add('error');
    }
  }

  /**
   * 更新同步状态
   */
  private updateSyncStatus(lastSyncTime: number | null): void {
    const statusElement = document.getElementById('sync-status');
    if (!statusElement) return;

    if (lastSyncTime) {
      const date = new Date(lastSyncTime);
      statusElement.textContent = `Last sync: ${date.toLocaleTimeString()}`;
    } else {
      statusElement.textContent = 'Ready';
    }
  }
}

// 导出初始化函数
export function initUI(): void {
  const ui = new CounterUI();
  ui.create();
}

// 自动初始化
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initUI());
  } else {
    initUI();
  }
}
