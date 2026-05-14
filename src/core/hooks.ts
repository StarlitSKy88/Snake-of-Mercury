/**
 * Hooks — Agent 循环拦截点 (P2-1: OpenHarness)
 */
export type HookEvent = 'pre_tool_use' | 'post_tool_use' | 'pre_agent_turn' | 'post_agent_turn';

export interface HookContext {
  event: HookEvent;
  agentName: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  iteration: number;
  timestamp: number;
}

export interface HookResult { allowed: boolean; reason?: string; log?: string; }

export type HookFn = (ctx: HookContext) => HookResult | Promise<HookResult>;

export class HookRegistry {
  private hooks: Map<HookEvent, HookFn[]> = new Map();

  register(event: HookEvent, fn: HookFn): void {
    const list = this.hooks.get(event) || [];
    list.push(fn);
    this.hooks.set(event, list);
  }

  async execute(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const fns = this.hooks.get(event) || [];
    for (const fn of fns) {
      const result = await fn(ctx);
      if (!result.allowed) return result;
    }
    return { allowed: true };
  }

  static createDefault(): HookRegistry {
    const r = new HookRegistry();
    r.register('pre_tool_use', (ctx) => {
      const blocked = ['rm -rf /', 'DROP TABLE', ':(){ :|:& };:'];
      const tool = ctx.toolInput ? JSON.stringify(ctx.toolInput) : '';
      if (blocked.some(b => tool.includes(b))) {
        return { allowed: false, reason: `危险工具已拦截` };
      }
      return { allowed: true };
    });
    r.register('post_tool_use', (ctx) => ({
      allowed: true,
      log: `[${ctx.agentName}] ${ctx.toolName}: ${(ctx.toolOutput || '').slice(0, 200)}`
    }));
    return r;
  }
}
