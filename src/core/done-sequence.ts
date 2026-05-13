/**
 * DoneSequence — 多事件任务完成检测
 * 
 * 借鉴 Langroid DoneSequence + AgentEvent 模型:
 *   - 不再靠字符串匹配 "TASK_COMPLETE"
 *   - 靠事件序列: ToolCall → ExecutorResult → EvaluatorApproval
 *   - 支持正则内容匹配 (CONTENT_MATCH 可匹配任何事件类型的内容)
 * 
 * 解决问题: "看起来完成了"这类字符串也会触发 TASK_COMPLETE 导致假通过
 */

// ============ 类型定义 ============

export type EventKind = 
  | 'tool_call'         // Agent 调用了工具
  | 'specific_tool'     // 调用了特定名称的工具
  | 'llm_response'      // LLM 产生了文本响应
  | 'agent_response'    // Agent 内部响应
  | 'content_match'     // 输出匹配特定正则 (可匹配任何事件的内容)
  | 'executor_pass'     // CodeExecutor 验证通过
  | 'executor_fail';    // CodeExecutor 验证失败

export interface DoneEvent {
  eventType: EventKind;
  toolName?: string;         // specific_tool 时需要
  contentPattern?: string;   // content_match 时需要 (正则)
  sender?: string;           // 发送方
}

export interface DoneSequence {
  name: string;
  events: DoneEvent[];
}

// ============ 预定义序列 ============

export const CODING_TASK_DONE: DoneSequence = {
  name: 'coding-task-complete',
  events: [
    { eventType: 'llm_response' },
    { eventType: 'executor_pass' },
    { eventType: 'content_match', contentPattern: '总分[:：]\\s*[89]\\.\\d+' },
    { eventType: 'content_match', contentPattern: 'APPROVED|通过|批准' },
  ],
};

export const DEPLOY_TASK_DONE: DoneSequence = {
  name: 'deploy-task-complete',
  events: [
    { eventType: 'specific_tool', toolName: 'deploy' },
    { eventType: 'content_match', contentPattern: 'deploy.*success|部署.*成功' },
  ],
};

export const ANALYSIS_TASK_DONE: DoneSequence = {
  name: 'analysis-task-complete',
  events: [
    { eventType: 'llm_response' },
    { eventType: 'content_match', contentPattern: 'SPECIFY|ASSUMPTIONS|PRD|需求文档|Sprint' },
  ],
};

// ============ 匹配器 ============

export interface EventLogEntry {
  eventType: EventKind;
  toolName?: string;
  content: string;
  sender: string;
  timestamp: number;
}

export class DoneSequenceMatcher {
  private log: EventLogEntry[] = [];

  record(entry: EventLogEntry): void {
    this.log.push(entry);
    if (this.log.length > 100) this.log.shift();
  }

  match(sequence: DoneSequence): boolean {
    if (!sequence.events.length) return false;
    
    let seqIdx = 0;
    for (const entry of this.log) {
      if (seqIdx >= sequence.events.length) break;
      const expected = sequence.events[seqIdx];
      if (this._entryMatches(entry, expected)) {
        seqIdx++;
      }
    }
    return seqIdx === sequence.events.length;
  }

  matchAny(sequences: DoneSequence[]): { matched: boolean; name: string } {
    for (const seq of sequences) {
      if (this.match(seq)) {
        return { matched: true, name: seq.name };
      }
    }
    return { matched: false, name: '' };
  }

  reset(): void {
    this.log = [];
  }

  get size(): number {
    return this.log.length;
  }

  // ===== 内部 =====

  private _entryMatches(entry: EventLogEntry, expected: DoneEvent): boolean {
    // content_match: 特殊处理——匹配任何事件类型的内容
    if (expected.eventType === 'content_match' && expected.contentPattern) {
      try {
        const re = new RegExp(expected.contentPattern, 'i');
        return re.test(entry.content);
      } catch {
        return false;
      }
    }

    // specific_tool: 需要 tool_call + 特定工具名
    if (expected.eventType === 'specific_tool') {
      if (entry.eventType !== 'tool_call') return false;
      if (expected.toolName && entry.toolName !== expected.toolName) return false;
      return true;
    }

    // 其他事件类型: 严格匹配
    if (expected.eventType !== entry.eventType) return false;

    // 发送方匹配
    if (expected.sender && entry.sender !== expected.sender) return false;

    return true;
  }
}

// ============ 假成功检测 ============

export const FALSE_SUCCESS_PATTERNS = [
  /看起来.*完[成毕]/i,
  /似乎.*正常/i,
  /probably.*(done|fine|complete)/i,
  /应该.*(可以|没问题)/i,
  /任务.*看起来.*完成/i,
  /seems.*(ok|good|fine)/i,
  /maybe.*(done|ready)/i,
];

export function isFalseSuccess(output: string): { found: boolean; pattern: string } {
  for (const p of FALSE_SUCCESS_PATTERNS) {
    const m = output.match(p);
    if (m) return { found: true, pattern: m[0] };
  }
  return { found: false, pattern: '' };
}
