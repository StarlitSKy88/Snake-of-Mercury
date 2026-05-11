/**
 * Toast 通知 Hook
 */

import { useState, useCallback, useRef } from 'react';
import { ToastMessage, ToastType } from '../types';
import { generateId } from '../utils/idGenerator';

interface UseToastOptions {
  defaultDuration?: number;
}

interface UseToastReturn {
  toasts: ToastMessage[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  hideToast: (id: string) => void;
  hideAll: () => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

/**
 * Toast 通知管理 Hook
 * @param options - 配置选项
 * @returns Toast 操作接口
 */
export function useToast(options: UseToastOptions = {}): UseToastReturn {
  const { defaultDuration = 3000 } = options;

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /**
   * 显示 Toast 通知
   */
  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = defaultDuration) => {
      const id = generateId();
      const toast: ToastMessage = {
        id,
        message,
        type,
        duration,
      };

      setToasts((prev) => [...prev, toast]);

      // 设置自动消失定时器
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, duration);

      timersRef.current.set(id, timer);
    },
    [defaultDuration]
  );

  /**
   * 隐藏指定的 Toast
   */
  const hideToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * 隐藏所有 Toast
   */
  const hideAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  /**
   * 显示成功通知
   */
  const success = useCallback(
    (message: string) => showToast(message, 'success'),
    [showToast]
  );

  /**
   * 显示错误通知
   */
  const error = useCallback(
    (message: string) => showToast(message, 'error'),
    [showToast]
  );

  /**
   * 显示警告通知
   */
  const warning = useCallback(
    (message: string) => showToast(message, 'warning'),
    [showToast]
  );

  /**
   * 显示信息通知
   */
  const info = useCallback(
    (message: string) => showToast(message, 'info'),
    [showToast]
  );

  return {
    toasts,
    showToast,
    hideToast,
    hideAll,
    success,
    error,
    warning,
    info,
  };
}
