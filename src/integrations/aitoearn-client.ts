/**
 * AiToEarn MCP Client
 * 
 * 跨12平台内容变现自动化接口
 * 
 * MCP Endpoint: https://aitoearn.ai/api/unified/mcp
 * Auth: x-api-key header
 * 
 * 12 platforms: 抖音/TikTok/YouTube/Instagram/Facebook/X/LinkedIn/
 *               Pinterest/Bilibili/快手/小红书/Threads
 * 
 * Monetization: CPS (按成交) | CPE ($0.8/互动) | CPM ($1/千次)
 */

// ============= 配置 =============

export interface AiToEarnConfig {
  apiKey: string;
  baseUrl?: string;   // 默认 https://aitoearn.ai
  timeout?: number;
}

// ============= 类型 =============

export interface MediaGroup {
  id: string;
  name: string;
  mediaCount: number;
  createdAt: string;
}

export interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  name: string;
  size: number;
  groupId?: string;
}

export interface DraftGroup {
  id: string;
  name: string;
  draftCount: number;
}

export interface DraftContent {
  id: string;
  title: string;
  content: string;
  topics: string[];
  mediaIds: string[];
  platformTargets: string[];
  status: 'draft' | 'scheduled' | 'published';
}

export interface PublishResult {
  draftId: string;
  platforms: Record<string, {
    published: boolean;
    url?: string;
    error?: string;
  }>;
  timestamp: string;
}

export interface EarningsSummary {
  totalCPS: number;
  totalCPE: number;
  totalCPM: number;
  byPlatform: Record<string, { cps: number; cpe: number; cpm: number }>;
  period: string;
}

// ============= 客户端 =============

export class AiToEarnClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: AiToEarnConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://aitoearn.ai';
    this.timeout = config.timeout || 30000;
  }

  // ===== 素材管理 =====

  /** 获取素材分组 */
  async getMediaGroupByName(name: string): Promise<MediaGroup | null> {
    const result = await this.call('getMediaGroupInfoByName', { name }) as { group?: MediaGroup } | null;
    return result?.group || null;
  }

  /** 上传素材 */
  async createMedia(params: {
    name: string;
    type: 'image' | 'video';
    url: string;
    groupName?: string;
  }): Promise<MediaItem> {
    const result = await this.call('createMedia', params);
    return result as MediaItem;
  }

  // ===== 内容管理 =====

  /** 获取草稿分组 */
  async getDraftGroupByName(name: string): Promise<DraftGroup | null> {
    const result = await this.call('getDraftGroupInfoByName', { name }) as { group?: DraftGroup } | null;
    return result?.group || null;
  }

  /** 创建草稿 */
  async createDraft(params: {
    title: string;
    content: string;
    topics?: string[];
    mediaIds?: string[];
    platformTargets?: string[];
    groupName?: string;
  }): Promise<DraftContent> {
    const result = await this.call('createDraft', params) as DraftContent;
    return result;
  }

  /** 发布草稿 */
  async publishDraft(draftId: string): Promise<PublishResult> {
    const result = await this.call('publishDraft', { draftId });
    return result as PublishResult;
  }

  // ===== 一键发布（创建+发布） =====

  /** 
   * 创建并发布——最常用路径
   * @returns 发布结果，含各平台链接
   */
  async createAndPublish(params: {
    title: string;
    content: string;
    topics?: string[];
    mediaUrls?: { url: string; type: 'image' | 'video'; name: string }[];
    platformTargets?: string[];
  }): Promise<{ draft: DraftContent; publish: PublishResult }> {
    // 1. 上传素材
    const mediaIds: string[] = [];
    if (params.mediaUrls?.length) {
      for (const media of params.mediaUrls) {
        const item = await this.createMedia({
          name: media.name,
          type: media.type,
          url: media.url,
        });
        mediaIds.push(item.id);
      }
    }

    // 2. 创建草稿
    const draft = await this.createDraft({
      title: params.title,
      content: params.content,
      topics: params.topics,
      mediaIds,
      platformTargets: params.platformTargets,
    });

    // 3. 发布
    const publish = await this.publishDraft(draft.id);

    return { draft, publish };
  }

  // ===== 收益查询 =====

  /** 查询收益摘要 */
  async getEarningsSummary(period: string = '30d'): Promise<EarningsSummary> {
    const result = await this.call('getEarningsSummary', { period });
    return result as EarningsSummary;
  }

  // ===== 底层 MCP 调用 =====

  private async call(tool: string, params: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/unified/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          tool,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AiToEarn MCP error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      return (data as Record<string, unknown>).result || data;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`AiToEarn MCP timeout after ${this.timeout}ms: ${tool}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============= 工厂 =============

/** 从环境变量创建客户端 */
export function createAiToEarnClient(apiKey?: string): AiToEarnClient | null {
  const key = apiKey || process.env.AITO_EARN_API_KEY;
  if (!key) {
    console.warn('[AiToEarn] ⚠️ 未配置 AITO_EARN_API_KEY，AiToEarn 集成禁用');
    return null;
  }
  return new AiToEarnClient({ apiKey: key });
}
