// 加密安全的 ID 生成
import { randomUUID } from 'crypto';

/**
 * 生成加密安全的 UUID
 */
export function generateSecureId(): string {
  return randomUUID();
}

/**
 * 验证 UUID 格式
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
