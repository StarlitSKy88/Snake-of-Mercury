// Toast 通知系统
import { ToastMessage } from './types';
import { generateSecureId } from './crypto';

const toastContainerId = 'toast-container';

/**
 * 创建 Toast 容器
 */
function ensureToastContainer(): HTMLElement {
  let container = document.getElementById(toastContainerId);
  if (!container) {
    container = document.createElement('div');
    container.id = toastContainerId;
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 显示 Toast 通知
 */
export function showToast(
  message: string,
  type: ToastMessage['type'] = 'success',
  duration: number = 3000
): string {
  const id = generateSecureId();
  const container = ensureToastContainer();
  
  const toast = document.createElement('div');
  toast.id = id;
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // 添加关闭按钮
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => hideToast(id);
  toast.appendChild(closeBtn);
  
  container.appendChild(toast);
  
  // 触发动画
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });
  
  // 自动隐藏
  if (duration > 0) {
    setTimeout(() => hideToast(id), duration);
  }
  
  return id;
}

/**
 * 隐藏 Toast 通知
 */
export function hideToast(id: string): void {
  const toast = document.getElementById(id);
  if (toast) {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hidden');
    setTimeout(() => toast.remove(), 300);
  }
}

/**
 * 隐藏所有 Toast
 */
export function hideAllToasts(): void {
  const container = document.getElementById(toastContainerId);
  if (container) {
    container.innerHTML = '';
  }
}

/**
 * 显示成功提示
 */
export function showSuccess(message: string, duration?: number): string {
  return showToast(message, 'success', duration);
}

/**
 * 显示错误提示
 */
export function showError(message: string, duration?: number): string {
  return showToast(message, 'error', duration ?? 5000);
}

/**
 * 显示警告提示
 */
export function showWarning(message: string, duration?: number): string {
  return showToast(message, 'warning', duration);
}

/**
 * 显示加载提示
 */
export function showLoading(message: string = 'Loading...'): string {
  return showToast(message, 'loading', 0); // 不自动隐藏
}
