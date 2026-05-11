/**
 * 计数器应用入口
 * 初始化核心逻辑和 UI
 */

import * as counter from './counter';
import { initUI } from './ui';

// 暴露到全局
if (typeof window !== 'undefined') {
  (window as any).counter = {
    getValue: counter.getValue,
    increment: counter.increment,
    decrement: counter.decrement,
    reset: counter.reset,
    setValue: counter.setValue,
    exportToJSON: counter.exportToJSON,
    exportToCSV: counter.exportToCSV,
    downloadFile: counter.downloadFile,
    getHistory: counter.getHistory,
    clearHistory: counter.clearHistory,
    getState: counter.getState,
    isLoading: counter.isLoading,
    setLoading: counter.setLoading,
    setStateChangeCallback: counter.setStateChangeCallback,
    setToastCallback: counter.setToastCallback,
    initKeyboardShortcuts: counter.initKeyboardShortcuts,
    init: counter.init,
    resetState: counter.resetState,
  };
}

// 初始化应用
export function bootstrap(): void {
  counter.init();
  counter.initKeyboardShortcuts();
  initUI();
}

// 导出所有功能
export {
  getValue,
  increment,
  decrement,
  reset,
  setValue,
  exportToJSON,
  exportToCSV,
  downloadFile,
  getHistory,
  clearHistory,
  getState,
  isLoading,
  setLoading,
  setStateChangeCallback,
  setToastCallback,
  initKeyboardShortcuts,
  init,
  resetState,
} from './counter';

export { initUI };

// 自动启动
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
