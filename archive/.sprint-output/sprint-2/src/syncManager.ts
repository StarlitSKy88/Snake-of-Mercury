/**
 * 同步管理器
 * 处理客户端同步调度、离线存储和重试队列
 */

export type SyncStatus = 'synced' | 'pending' | 'error';
export type StatusChangeCallback = (status: SyncStatus) => void;

interface SyncTask {
  id: string;
  data: unknown;
  retries: number;
  maxRetries: number;
  createdAt: number;
}

export class SyncManager {
  private status: SyncStatus = 'synced';
  private listeners: Set<StatusChangeCallback> = new Set();
  private retryQueue: SyncTask[] = [];
  private maxRetries: number = 3;
  private retryDelay: number = 5000;
  private isOnline: boolean = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncEndpoint: string = '/api/sync';

  constructor() {
    this.setupNetworkListeners();
    this.startRetryProcessor();
  }

  /**
   * 设置网络监听
   */
  private setupNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    this.isOnline = navigator.onLine;

    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processRetryQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateStatus('error');
    });
  }

  /**
   * 将同步任务加入队列
   */
  queueSync(data: unknown): void {
    const task: SyncTask = {
      id: this.generateTaskId(),
      data,
      retries: 0,
      maxRetries: this.maxRetries,
      createdAt: Date.now()
    };

    this.retryQueue.push(task);
    this.updateStatus('pending');

    if (this.isOnline) {
      this.processTask(task);
    }
  }

  /**
   * 处理单个同步任务
   */
  private async processTask(task: SyncTask): Promise<void> {
    try {
      await this.sendToServer(task.data);
      this.removeFromQueue(task.id);
      this.updateStatus(this.retryQueue.length > 0 ? 'pending' : 'synced');
    } catch (error) {
      console.error('Sync failed for task:', task.id, error);
      task.retries++;
      
      if (task.retries >= task.maxRetries) {
        this.removeFromQueue(task.id);
        this.updateStatus(this.retryQueue.length > 0 ? 'pending' : 'error');
      } else {
        this.scheduleRetry(task);
      }
    }
  }

  /**
   * 发送到服务器
   */
  private async sendToServer(data: unknown): Promise<void> {
    const response = await fetch(this.syncEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }
  }

  /**
   * 调度重试
   */
  private scheduleRetry(task: SyncTask): void {
    setTimeout(() => {
      if (this.isOnline) {
        this.processTask(task);
      }
    }, this.retryDelay * task.retries);
  }

  /**
   * 处理重试队列
   */
  private processRetryQueue(): void {
    while (this.retryQueue.length > 0 && this.isOnline) {
      const task = this.retryQueue[0];
      this.processTask(task);
    }
  }

  /**
   * 启动重试处理器
   */
  private startRetryProcessor(): void {
    this.retryTimer = setInterval(() => {
      if (this.isOnline && this.retryQueue.length > 0) {
        this.processRetryQueue();
      }
    }, this.retryDelay);
  }

  /**
   * 从队列中移除任务
   */
  private removeFromQueue(taskId: string): void {
    this.retryQueue = this.retryQueue.filter(t => t.id !== taskId);
  }

  /**
   * 更新同步状态
   */
  private updateStatus(newStatus: SyncStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.notifyListeners();
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach(callback => {
      try {
        callback(this.status);
      } catch (error) {
        console.error('Listener error:', error);
      }
    });
  }

  /**
   * 订阅状态变化
   */
  onStatusChange(callback: StatusChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 获取当前状态
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    if (typeof window !== 'undefined' && window.crypto) {
      return crypto.randomUUID();
    }
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 手动触发同步
   */
  async forceSync(): Promise<boolean> {
    if (!this.isOnline) {
      return false;
    }

    try {
      await this.processRetryQueue();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
    }
    this.listeners.clear();
    this.retryQueue = [];
  }
}
