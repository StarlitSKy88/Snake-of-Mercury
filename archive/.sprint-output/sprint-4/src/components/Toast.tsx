/**
 * Toast 通知组件
 */

import React from 'react';
import { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onHide: (id: string) => void;
}

/**
 * Toast 容器组件
 * 显示堆叠的通知消息
 */
export const ToastContainer: React.FC<ToastProps> = ({ toasts, onHide }) => {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '400px',
      }}
      role="region"
      aria-label="通知消息"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => onHide(toast.id)} />
      ))}
    </div>
  );
};

interface ToastItemProps {
  toast: ToastMessage;
  onClose: () => void;
}

/**
 * 单个 Toast 消息项
 */
const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose }) => {
  const styles = getToastStyles(toast.type);

  return (
    <div
      style={{
        ...styles.container,
        animation: 'slideIn 0.3s ease-out',
      }}
      role="alert"
      aria-live="polite"
    >
      <span style={styles.icon}>{getToastIcon(toast.type)}</span>
      <span style={styles.message}>{toast.message}</span>
      <button
        onClick={onClose}
        style={styles.closeButton}
        aria-label="关闭通知"
      >
        ×
      </button>
    </div>
  );
};

/**
 * 根据类型获取样式
 */
function getToastStyles(type: ToastMessage['type']): {
  container: React.CSSProperties;
  icon: React.CSSProperties;
  message: React.CSSProperties;
  closeButton: React.CSSProperties;
} {
  const baseStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    minWidth: '280px',
    maxWidth: '400px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
  };

  const colorMap: Record<ToastMessage['type'], { bg: string; border: string; icon: string }> = {
    success: { bg: '#d4edda', border: '#28a745', icon: '#155724' },
    error: { bg: '#f8d7da', border: '#dc3545', icon: '#721c24' },
    warning: { bg: '#fff3cd', border: '#ffc107', icon: '#856404' },
    info: { bg: '#d1ecf1', border: '#17a2b8', icon: '#0c5460' },
  };

  const colors = colorMap[type];

  return {
    container: {
      ...baseStyles,
      backgroundColor: colors.bg,
      borderLeft: `4px solid ${colors.border}`,
      color: colors.icon,
    },
    icon: {
      marginRight: '12px',
      fontSize: '18px',
    },
    message: {
      flex: 1,
    },
    closeButton: {
      background: 'transparent',
      border: 'none',
      fontSize: '20px',
      cursor: 'pointer',
      color: colors.icon,
      padding: '0 0 0 8px',
      opacity: 0.7,
    },
  };
}

/**
 * 获取 Toast 图标
 */
function getToastIcon(type: ToastMessage['type']): string {
  const icons: Record<ToastMessage['type'], string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };
  return icons[type];
}
