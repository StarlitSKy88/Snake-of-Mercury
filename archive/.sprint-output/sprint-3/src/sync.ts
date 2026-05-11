// 离线同步调度器
import { CounterState } from './types';

export interface SyncScheduler {
  lastSyncTime: number;
  isOnline: boolean;
  pendingOperations: number;
  retryQueue: (() => Promise<void>)[];
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const SYNC_INTERVAL_MS = 30000;

/**
 * 创建同步调度器
 */
export function createSyncScheduler(): SyncScheduler {
  return {
    lastSyncTime: 0,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingOperations: 0,
    retryQueue: [],
  };
}

/**
 * 检查网络状态
 */
export function checkOnlineStatus(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * 设置网络状态监听
 */
export function setupNetworkListener(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/**
 * 模拟同步操作
 */
export async function syncState(state: CounterState): Promise<boolean> {
  if (!checkOnlineStatus()) {
    return false;
  }
  
  try {
    // 模拟网络请求延迟
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // 在实际应用中，这里会发送数据到服务器
    console.log('State synced:', state.value);
    
    return true;
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
}

/**
 * 带重试的同步操作
 */
export async function syncWithRetry(
  state: CounterState,
  scheduler: SyncScheduler,
  maxAttempts: number = MAX_RETRY_ATTEMPTS
): Promise<boolean> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const success = await syncState(state);
      if (success) {
        scheduler.lastSyncTime = Date.now();
        scheduler.pendingOperations = 0;
        return true;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt)
        );
      }
    }
  }
  
  // 同步失败，添加到重试队列
  scheduler.retryQueue.push(async () => {
    await syncWithRetry(state, scheduler, maxAttempts);
  });
  
  throw lastError || new Error('Sync failed after all retries');
}

/**
 * 处理重试队列
 */
export async function processRetryQueue(
  scheduler: SyncScheduler
): Promise<void> {
  if (!scheduler.isOnline || scheduler.retryQueue.length === 0) {
    return;
  }
  
  const queue = [...scheduler.retryQueue];
  scheduler.retryQueue = [];
  
  for (const operation of queue) {
    try {
      await operation();
    } catch (error) {
      console.error('Retry operation failed:', error);
    }
  }
}

/**
 * 启动定期同步
 */
export function startPeriodicSync(
  getState: () => CounterState,
  scheduler: SyncScheduler,
  onSyncComplete: (success: boolean) => void
): () => void {
  const intervalId = setInterval(async () => {
    if (scheduler.isOnline) {
      try {
        const success = await syncWithRetry(getState(), scheduler);
        onSyncComplete(success);
      } catch {
        onSyncComplete(false);
      }
    }
  }, SYNC_INTERVAL_MS);
  
  return () => clearInterval(intervalId);
}
