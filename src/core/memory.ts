/**
 * AgentMemory — 跨会话持久化记忆系统
 * 
 * 学习自 Ruflo HybridBackend (SQLite + AgentDB)
 * Snake-of-Mercury 版: JSONL 持久化 + 内存索引 + 语义搜索
 * 
 * 核心能力:
 * - 跨会话持久化（文件存储，重启不丢失）
 * - 结构化查询（按 key/namespace/type 精确查找）
 * - 语义搜索（embedding 相似度，可插拔）
 * - 自动去重 + 过期清理
 * - 命名空间隔离（按项目/Agent 隔离）
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============= 类型 =============

export interface MemoryEntry {
  id: string;
  namespace: string;       // 项目ID 或 Agent 名称
  type: 'pattern' | 'decision' | 'anti_pattern' | 'fix' | 'context' | 'task_result';
  key?: string;            // 可选唯一键（用于去重）
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];    // 可选向量（用于语义搜索）
  score?: number;          // 重要性 0-1
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;      // 可选过期时间
}

export interface MemoryQuery {
  namespace?: string;
  type?: MemoryEntry['type'];
  key?: string;
  textSearch?: string;     // 文本搜索
  semanticSearch?: string; // 语义搜索（需要 embedding）
  limit?: number;
  since?: string;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;           // 相关性分数 0-1
}

export interface MemoryStats {
  totalEntries: number;
  byNamespace: Record<string, number>;
  byType: Record<string, number>;
  oldestEntry: string;
  newestEntry: string;
}

// ============= 实现 =============

export class AgentMemory {
  private entries: Map<string, MemoryEntry> = new Map();
  private indexPath: string;
  private journalPath: string;
  private dirty = false;
  private autoSaveInterval: ReturnType<typeof setInterval>;

  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
    this.indexPath = join(baseDir, 'memory-index.json');
    this.journalPath = join(baseDir, 'memory-journal.jsonl');
    this.load();
    // P0修复: 进程退出时确保 flush
    this._setupExitHandlers();
    
    // 每30秒自动保存
    this.autoSaveInterval = setInterval(() => this.flush(), 5000); // P0修复: 30s→5s, 减少crash数据丢失
  }

  // ===== CRUD =====

  /** 写入记忆 */
  put(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> & { metadata?: Record<string, unknown> }): MemoryEntry {
    const metadata = entry.metadata || {};
    // 去重：同 namespace + key 则更新
    if (entry.key) {
      const existing = this.findByKey(entry.namespace, entry.key);
      if (existing) {
        const updated = this.update(existing.id, { content: entry.content, metadata: entry.metadata });
        if (updated) return updated;
      }
    }

    const now = new Date().toISOString();
    const full: MemoryEntry = {
      ...entry,
      metadata,
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(full.id, full);
    this.appendJournal(full);
    this.dirty = true;
    return full;
  }

  /** 更新记忆 */
  update(id: string, partial: Partial<Pick<MemoryEntry, 'content' | 'metadata' | 'score' | 'embedding'>>): MemoryEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    Object.assign(entry, partial, { updatedAt: new Date().toISOString() });
    this.dirty = true;
    return entry;
  }

  /** 获取单条 */
  get(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  /** 删除 */
  delete(id: string): boolean {
    const result = this.entries.delete(id);
    if (result) this.dirty = true;
    return result;
  }

  // ===== 查询 =====

  /** 通用查询 */
  query(q: MemoryQuery = {}): MemoryEntry[] {
    let results = [...this.entries.values()];

    if (q.namespace) results = results.filter(e => e.namespace === q.namespace);
    if (q.type) results = results.filter(e => e.type === q.type);
    if (q.key) results = results.filter(e => e.key === q.key);
    if (q.since) results = results.filter(e => e.updatedAt >= q.since!);
    
    // 过期过滤
    const now = new Date().toISOString();
    results = results.filter(e => !e.expiresAt || e.expiresAt > now);

    // 文本搜索
    if (q.textSearch) {
      const qLower = q.textSearch.toLowerCase();
      results = results.filter(e => e.content.toLowerCase().includes(qLower));
    }

    // 按更新时间降序
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    
    if (q.limit) results = results.slice(0, q.limit);
    return results;
  }

  /** 语义搜索（简化版：基于文本相似度；可替换为 embedding） */
  search(query: string, namespace?: string, limit = 10): SearchResult[] {
    const candidates = this.query({ namespace, limit: 100 });
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    const scored: SearchResult[] = candidates.map(entry => {
      let score = 0;
      const contentLower = entry.content.toLowerCase();

      // 精确匹配
      if (contentLower.includes(queryLower)) score += 0.5;
      
      // 词匹配
      for (const word of queryWords) {
        if (contentLower.includes(word)) score += 0.1;
      }

      // 重要性加权
      score += (entry.score || 0.5) * 0.2;
      
      // 时间衰减（越新越高）
      const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / 86400000;
      score += Math.max(0, 0.1 - ageDays * 0.001);

      return { entry, score: Math.min(1, score) };
    });

    return scored
      .filter(s => s.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** 按 key 精确查找 */
  findByKey(namespace: string, key: string): MemoryEntry | undefined {
    return [...this.entries.values()].find(e => e.namespace === namespace && e.key === key);
  }

  /** 获取项目的所有记忆 */
  getProjectMemory(projectId: string, limit = 50): MemoryEntry[] {
    return this.query({ namespace: projectId, limit });
  }

  // ===== 维护 =====

  /** 清理过期条目 */
  purge(): number {
    const now = new Date().toISOString();
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.entries.delete(id);
        count++;
      }
    }
    if (count > 0) this.dirty = true;
    return count;
  }

  /** 统计 */
  stats(): MemoryStats {
    const byNamespace: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let oldest = '', newest = '';

    for (const entry of this.entries.values()) {
      byNamespace[entry.namespace] = (byNamespace[entry.namespace] || 0) + 1;
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (!oldest || entry.createdAt < oldest) oldest = entry.createdAt;
      if (!newest || entry.createdAt > newest) newest = entry.createdAt;
    }

    return {
      totalEntries: this.entries.size,
      byNamespace, byType,
      oldestEntry: oldest, newestEntry: newest,
    };
  }

  // ===== 持久化 =====

  private appendJournal(entry: MemoryEntry): void {
    try {
      appendFileSync(this.journalPath, JSON.stringify(entry) + '\n');
    } catch { /* 静默失败，下次 flush 会补齐 */ }
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      writeFileSync(this.indexPath, JSON.stringify([...this.entries.values()], null, 2));
      this.dirty = false;
    } catch (err) {
      console.error('[AgentMemory] flush 失败:', err);
    }
  }

  private load(): void {
    // 优先从 index 加载（快）
    if (existsSync(this.indexPath)) {
      try {
        const data = JSON.parse(readFileSync(this.indexPath, 'utf-8')) as MemoryEntry[];
        for (const entry of data) {
          this.entries.set(entry.id, entry);
        }
        return;
      } catch { /* index 损坏，从 journal 恢复 */ }
    }

    // P0修复: journal 为主要恢复路径，index 只是缓存
    if (existsSync(this.journalPath)) {
      try {
        const lines = readFileSync(this.journalPath, 'utf-8').trim().split('\n');
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as MemoryEntry;
            this.entries.set(entry.id, entry);
          } catch { /* skip bad lines */ }
        }
      } catch { /* empty or corrupt */ }
    }
  }

  /** 关闭（保存并清理定时器） */
  /** P0修复: 注册进程退出处理器 */
  private _setupExitHandlers(): void {
    const cleanup = () => { this.flush(); };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('beforeExit', cleanup);
  }

  close(): void {
    clearInterval(this.autoSaveInterval);
    this.flush();
  }
}

// ═══════════ P1-8: 闭环反思 (借鉴 TradingAgents Reflector + MemoryLog) ═══════════

export interface ReflectionEntry {
  taskId: number;
  projectName: string;
  outcome: 'pass' | 'fail';
  lesson: string;           // 2-4句精炼教训
  rawReturn?: string;       // 可量化指标（如"总分8.5/10"）
  createdAt: string;
}

export class ReflectionLog {
  private logPath: string;
  private static SEPARATOR = '\n\n<!-- ENTRY_END -->\n\n';

  constructor(baseDir: string) {
    this.logPath = join(baseDir, 'reflection-log.md');
  }

  /**
   * 记录任务反思
   * 借鉴 TradingAgents: 2-4句精炼教训
   */
  record(reflection: ReflectionEntry): void {
    const tag = `[${reflection.createdAt} | ${reflection.projectName} | ${reflection.outcome} | ${reflection.rawReturn || 'n/a'}]`;
    const entry = `${tag}\n\nLESSON:\n${reflection.lesson}${ReflectionLog.SEPARATOR}`;
    try {
      appendFileSync(this.logPath, entry);
    } catch { /* 静默 */ }
  }

  /**
   * 获取项目的历史教训 (用于注入到新任务 prompt)
   * 借鉴 TradingAgents get_past_context():
   *   - 同项目最多 5 条
   *   - 跨项目最多 3 条
   */
  getPastContext(projectName: string, nSame = 5, nCross = 3): string {
    const entries = this.loadAll();
    if (entries.length === 0) return '';

    const same: ReflectionEntry[] = [];
    const cross: ReflectionEntry[] = [];

    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.projectName === projectName && same.length < nSame) {
        same.push(e);
      } else if (e.projectName !== projectName && cross.length < nCross) {
        cross.push(e);
      }
      if (same.length >= nSame && cross.length >= nCross) break;
    }

    if (same.length === 0 && cross.length === 0) return '';

    const parts: string[] = [];
    if (same.length > 0) {
      parts.push(`## 历史教训 (${projectName}, 最近 ${same.length} 条)`);
      same.reverse().forEach(e => {
        parts.push(`- [${e.outcome}] ${e.lesson}`);
      });
    }
    if (cross.length > 0) {
      parts.push(`\n## 跨项目教训 (最近 ${cross.length} 条)`);
      cross.reverse().forEach(e => {
        parts.push(`- [${e.projectName} | ${e.outcome}] ${e.lesson}`);
      });
    }
    return parts.join('\n');
  }

  /**
   * 加载所有反思条目
   */
  loadAll(): ReflectionEntry[] {
    if (!existsSync(this.logPath)) return [];
    try {
      const text = readFileSync(this.logPath, 'utf-8');
      const blocks = text.split(ReflectionLog.SEPARATOR).filter(b => b.trim());
      const entries: ReflectionEntry[] = [];
      for (const block of blocks) {
        const parsed = this._parseBlock(block);
        if (parsed) entries.push(parsed);
      }
      return entries;
    } catch {
      return [];
    }
  }

  private _parseBlock(block: string): ReflectionEntry | null {
    const lines = block.trim().split('\n');
    if (lines.length < 2) return null;
    const tagLine = lines[0].trim();
    // 改进: 使用 [^\]]+ 替代 .+? 防止内容含 ] 时提前终止
    const tagMatch = tagLine.match(/\[([^\]]+)\]/);
    if (!tagMatch) return null;

    // 解析 tag: [date | projectName | outcome | rawReturn]
    const tagParts = tagMatch[1].split('|').map(s => s.trim());
    if (tagParts.length < 4) return null;

    const lessonMatch = block.match(/LESSON:\n([\s\S]*?)$/);
    const lesson = lessonMatch ? lessonMatch[1].trim() : '';

    // 验证字段合法性
    const validOutcomes = ['pass', 'fail', 'pending'];
    const outcome = validOutcomes.includes(tagParts[2]) ? tagParts[2] : 'fail';

    return {
      taskId: 0,
      projectName: tagParts[1] || 'unknown',
      outcome: outcome as 'pass' | 'fail',
      lesson,
      rawReturn: tagParts[3] || 'n/a',
      createdAt: tagParts[0] || new Date().toISOString(),
    };
  }
}
