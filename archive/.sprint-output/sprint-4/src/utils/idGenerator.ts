/**
 * 安全的 ID 生成器
 * 使用 crypto.randomUUID() 替代 Math.random()
 */

import { randomUUID } from 'crypto';

/**
 * 生成唯一的 UUID v4
 * @returns 加密安全的 UUID 字符串
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * 生成带前缀的 ID
 * @param prefix - 前缀标识
 * @returns 带前缀的唯一 ID
 */
export function generatePrefixedId(prefix: string): string {
  const uuid = randomUUID();
  return `${prefix}_${uuid}`;
}
