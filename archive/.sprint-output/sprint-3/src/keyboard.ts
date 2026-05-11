// 键盘快捷键支持
export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
}

type KeyHandler = () => void;

/**
 * 注册键盘快捷键
 */
export function registerShortcut(shortcut: KeyboardShortcut): () => void {
  const handler = (event: KeyboardEvent) => {
    const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
    const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
    const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
    const altMatch = shortcut.alt ? event.altKey : !event.altKey;
    
    if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
      event.preventDefault();
      shortcut.handler();
    }
  };
  
  document.addEventListener('keydown', handler);
  
  // 返回取消注册函数
  return () => document.removeEventListener('keydown', handler);
}

/**
 * 创建快捷键处理器
 */
export function createShortcutHandler(
  onIncrement: KeyHandler,
  onDecrement: KeyHandler,
  onReset: KeyHandler,
  onUndo: KeyHandler,
  onRedo: KeyHandler,
  onCancel: KeyHandler
): () => void {
  const shortcuts: KeyboardShortcut[] = [
    { key: '+', handler: onIncrement },
    { key: '=', handler: onIncrement },
    { key: '-', handler: onDecrement },
    { key: '_', handler: onDecrement },
    { key: 'r', handler: onReset, ctrl: true },
    { key: 'R', handler: onReset, shift: true },
    { key: 'z', handler: onUndo, ctrl: true },
    { key: 'Z', handler: onUndo, ctrl: true, shift: true },
    { key: 'y', handler: onRedo, ctrl: true },
    { key: 'Escape', handler: onCancel },
    { key: 'ArrowUp', handler: onIncrement },
    { key: 'ArrowDown', handler: onDecrement },
  ];
  
  const cleanups = shortcuts.map(registerShortcut);
  
  // 返回清理函数
  return () => cleanups.forEach((cleanup) => cleanup());
}

/**
 * 获取快捷键描述
 */
export function getShortcutDescription(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push('Ctrl');
  if (shortcut.shift) parts.push('Shift');
  if (shortcut.alt) parts.push('Alt');
  parts.push(shortcut.key.toUpperCase());
  return parts.join('+');
}
