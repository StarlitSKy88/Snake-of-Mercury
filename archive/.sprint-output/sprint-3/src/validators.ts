// 输入验证模块
import { DEFAULT_CONFIG } from './types';

/**
 * 验证数值是否为有效类型
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 验证增量值
 */
export function validateIncrementValue(value: number): number {
  if (!isValidNumber(value)) {
    throw new Error('Invalid type: value must be a number');
  }
  if (!Number.isInteger(value)) {
    throw new Error('Invalid value: must be an integer');
  }
  if (value <= 0) {
    throw new Error('Invalid value: step must be positive');
  }
  return value;
}

/**
 * 验证计数器值
 */
export function validateCounterValue(
  value: number,
  config = DEFAULT_CONFIG
): number {
  if (!isValidNumber(value)) {
    throw new Error('Invalid type: counter value must be a number');
  }
  if (!Number.isInteger(value)) {
    throw new Error('Invalid value: counter must be an integer');
  }
  if (value < config.minValue) {
    throw new Error(`Invalid value: cannot be less than ${config.minValue}`);
  }
  if (value > config.maxValue) {
    throw new Error(`Invalid value: cannot exceed ${config.maxValue}`);
  }
  return value;
}

/**
 * 验证设置值
 */
export function validateSetValue(
  value: number,
  config = DEFAULT_CONFIG
): number {
  const validated = validateCounterValue(value, config);
  return validated;
}

/**
 * 验证历史记录数量
 */
export function validateHistorySize(size: number): number {
  if (!isValidNumber(size)) {
    throw new Error('Invalid type: history size must be a number');
  }
  if (size < 0) {
    throw new Error('Invalid value: history size cannot be negative');
  }
  if (size > DEFAULT_CONFIG.maxHistorySize) {
    throw new Error(
      `Invalid value: history size cannot exceed ${DEFAULT_CONFIG.maxHistorySize}`
    );
  }
  return size;
}

/**
 * 验证导入数据
 */
export function validateImportData(data: unknown): data is {
  entries?: unknown[];
  finalValue?: number;
} {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  return true;
}
