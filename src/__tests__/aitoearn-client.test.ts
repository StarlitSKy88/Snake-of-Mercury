/**
 * AiToEarn MCP Client 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiToEarnClient, createAiToEarnClient, type AiToEarnConfig } from '../integrations/aitoearn-client.js';

const MOCK_CONFIG: AiToEarnConfig = {
  apiKey: 'test-key-123',
  baseUrl: 'https://aitoearn.ai',
  timeout: 5000,
};

describe('AiToEarnClient', () => {
  let client: AiToEarnClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new AiToEarnClient(MOCK_CONFIG);
  });

  it('应能从环境变量创建客户端', () => {
    process.env.AITO_EARN_API_KEY = 'env-key';
    const c = createAiToEarnClient();
    expect(c).not.toBeNull();
    delete process.env.AITO_EARN_API_KEY;
  });

  it('无 API Key 时应返回 null', () => {
    delete process.env.AITO_EARN_API_KEY;
    const c = createAiToEarnClient();
    expect(c).toBeNull();
  });

  it('应正确调用 getMediaGroupByName', async () => {
    const mockGroup = { id: 'g1', name: 'test', mediaCount: 3, createdAt: '2026-01-01' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { group: mockGroup } }),
    } as Response);

    const result = await client.getMediaGroupByName('test');
    expect(result).toEqual(mockGroup);
  });

  it('MCP 调用失败应抛出异常', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(client.getMediaGroupByName('test')).rejects.toThrow('AiToEarn MCP error');
  });

  it('createAndPublish 应串联素材→草稿→发布', async () => {
    // Mock createMedia
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { id: 'm1', url: 'x', type: 'image', name: 'img', size: 100 } }) } as Response)
      // Mock createDraft
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { id: 'd1', title: 'Test', content: 'hello', topics: [], mediaIds: [], platformTargets: [], status: 'draft' } }) } as Response)
      // Mock publishDraft
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { draftId: 'd1', platforms: { douyin: { published: true, url: 'https://douyin.com/v/123' } }, timestamp: '2026-01-01' } }) } as Response);

    const result = await client.createAndPublish({
      title: 'New Product',
      content: 'Amazing product',
      topics: ['tech'],
      mediaUrls: [{ url: 'https://img.url', type: 'image', name: 'screenshot' }],
      platformTargets: ['douyin'],
    });

    expect(result.draft.id).toBe('d1');
    expect(result.publish.platforms.douyin.published).toBe(true);
    expect(result.publish.platforms.douyin.url).toBe('https://douyin.com/v/123');
  });

  it('超时应抛出异常', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() =>
      new Promise((_, reject) => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      })
    );

    await expect(client.getMediaGroupByName('test')).rejects.toThrow('timeout');
  });
});
