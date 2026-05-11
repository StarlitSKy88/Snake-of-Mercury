/**
 * Toast 通知管理器
 * 提供成功/失败/警告三种样式反馈
 */

export type ToastType = 'success' | 'error' | 'warning';
export type ToastPosition = 'top' | 'bottom' | 'center';

interface ToastOptions {
  message: string;
  type: ToastType;
  duration?: number;
  position?: ToastPosition;
}

interface ToastInstance {
  id: string;
  element: HTMLElement;
  timeout: ReturnType<typeof setTimeout>;
}

export class ToastManager {
  private container: HTMLElement | null = null;
  private toasts: Map<string, ToastInstance> = new Map();
  private defaultDuration: number = 3000;
  private maxToasts: number = 5;

  constructor() {
    this.createContainer();
  }

  /**
   * 创建 Toast 容器
   */
  private createContainer(): void {
    if (typeof document === 'undefined') return;

    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.setAttribute('role', 'alert');
    this.container.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.container);
  }

  /**
   * 显示 Toast
   */
  show(message: string, type: ToastType = 'success', duration?: number): string {
    if (!this.container) {
      this.createContainer();
    }

    const id = this.generateId();
    const element = this.createToastElement(message, type);
    const toastDuration = duration ?? this.defaultDuration;

    // 限制最大 Toast 数量
    if (this.toasts.size >= this.maxToasts) {
      const oldest = this.toasts.keys().next().value;
      if (oldest) this.hide(oldest);
    }

    const timeout = setTimeout(() => {
      this.removeToast(id);
    }, toastDuration);

    element.addEventListener('click', () => {
      clearTimeout(timeout);
      this.removeToast(id);
    });

    this.container?.appendChild(element);
    this.toasts.set(id, { id, element, timeout });

    // 触发动画
    requestAnimationFrame(() => {
      element.classList.add('toast-visible');
    });

    return id;
  }

  /**
   * 创建 Toast 元素
   */
  private createToastElement(message: string, type: ToastType): HTMLElement {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.dataset.toastId = this.generateId();

    const icon = this.getIcon(type);
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${this.escapeHtml(message)}</span>
      <button class="toast-close" aria-label="关闭">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = toast.dataset.toastId;
      if (id) this.hide(id);
    });

    return toast;
  }

  /**
   * 获取图标
   */
  private getIcon(type: ToastType): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
    }
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 隐藏指定 Toast
   */
  hide(id: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      clearTimeout(toast.timeout);
      this.removeToast(id);
    }
  }

  /**
   * 移除 Toast 元素
   */
  private removeToast(id: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.element.classList.remove('toast-visible');
      toast.element.classList.add('toast-hidden');
      
      setTimeout(() => {
        toast.element.remove();
      }, 300);

      this.toasts.delete(id);
    }
  }

  /**
   * 隐藏所有 Toast
   */
  hideAll(): void {
    this.toasts.forEach((_, id) => {
      this.hide(id);
    });
  }

  /**
   * 显示成功提示
   */
  success(message: string, duration?: number): string {
    return this.show(message, 'success', duration);
  }

  /**
   * 显示错误提示
   */
  error(message: string, duration?: number): string {
    return this.show(message, 'error', duration ?? 5000);
  }

  /**
   * 显示警告提示
   */
  warning(message: string, duration?: number): string {
    return this.show(message, 'warning', duration ?? 4000);
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    if (typeof window !== 'undefined' && window.crypto) {
      return crypto.randomUUID();
    }
    return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.hideAll();
    this.container?.remove();
    this.container = null;
  }
}
