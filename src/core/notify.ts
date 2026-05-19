/**
 * 通知系统 — 可扩展的通知接口
 * T2.4: Webhook + Console 实现
 */

export interface NotificationEvent {
  type: 'project.completed' | 'project.failed' | 'approval.requested' | 'task.failed';
  projectId: string;
  projectName: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async notify(event: NotificationEvent): Promise<void> {
    const emoji: Record<string, string> = {
      'project.completed': '✅',
      'project.failed': '❌',
      'approval.requested': '📋',
      'task.failed': '⚠️',
    };
    console.log(`\n${emoji[event.type] || '📢'} [${event.type}] ${event.projectName}: ${event.message}`);
  }
}

export class WebhookNotifier implements Notifier {
  private url: string;

  constructor(url?: string) {
    this.url = url || process.env.WEBHOOK_URL || '';
  }

  async notify(event: NotificationEvent): Promise<void> {
    if (!this.url) return;
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch {
      // webhook 失败不应阻塞主流程
    }
  }
}

export class CompositeNotifier implements Notifier {
  private notifiers: Notifier[];

  constructor(...notifiers: Notifier[]) {
    this.notifiers = notifiers;
  }

  async notify(event: NotificationEvent): Promise<void> {
    await Promise.all(this.notifiers.map(n => n.notify(event).catch(() => {})));
  }
}

// 默认实例
export const notifier: Notifier = new CompositeNotifier(
  new ConsoleNotifier(),
  new WebhookNotifier()
);
