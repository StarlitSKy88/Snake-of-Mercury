/**
 * 输入验证工具
 * 实现 NaN/Infinity/负数/最大值检测
 */

import { ValidationError, CounterConfig } from '../types';

/** 默认计数器配置 */
export const DEFAULT_CONFIG: CounterConfig = {
  minValue: 0,
  maxValue: 999999,
  defaultStep: 1,
  maxHistorySize: 1000,
};

/**
 * 验证数值类型
 * @param value - 待验证的值
 * @returns 是否为有效数值类型
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number';
}

/**
 * 检测是否为 NaN
 * @param value - 待检测的值
 * @returns 是否为 NaN
 */
export function isNaNValue(value: unknown): boolean {
  return typeof value === 'number' && Number.isNaN(value);
}

/**
 * 检测是否为无穷大
 * @param value - 待检测的值
 * @returns 是否为 Infinity 或 -Infinity
 */
export function isInfinityValue(value: unknown): boolean {
  return typeof value === 'number' && !Number.isFinite(value);
}

/**
 * 检测是否为有限数值
 * @param value - 待检测的值
 * @returns 是否为有限数值
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 验证计数器数值
 * @param value - 计数器值
 * @param config - 配置选项
 * @returns 验证错误数组，无错误时返回空数组
 */
export function validateCounterValue(
  value: number,
  config: Partial<CounterConfig> = {}
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { minValue = DEFAULT_CONFIG.minValue, maxValue = DEFAULT_CONFIG.maxValue } = config;

  // 类型验证
  if (!isValidNumber(value)) {
    errors.push({
      field: 'value',
      message: '值必须是数字类型',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  // NaN 检测
  if (isNaNValue(value)) {
    errors.push({
      field: 'value',
      message: '值不能是 NaN',
      code: 'NOT_FINITE',
    });
    return errors;
  }

  // Infinity 检测
  if (isInfinityValue(value)) {
    errors.push({
      field: 'value',
      message: '值不能是 Infinity',
      code: 'NOT_FINITE',
    });
    return errors;
  }

  // 负数检测
  if (value < minValue) {
    errors.push({
      field: 'value',
      message: `值不能小于 ${minValue}`,
      code: 'UNDERFLOW',
    });
  }

  // 最大值限制
  if (value > maxValue) {
    errors.push({
      field: 'value',
      message: `值不能超过 ${maxValue}`,
      code: 'OVERFLOW',
    });
  }

  return errors;
}

/**
 * 验证步进值
 * @param step - 步进值
 * @returns 验证错误
 */
export function validateStep(step: number): ValidationError | null {
  if (!isValidNumber(step)) {
    return {
      field: 'step',
      message: '步进值必须是数字类型',
      code: 'INVALID_TYPE',
    };
  }

  if (isNaNValue(step) || isInfinityValue(step)) {
    return {
      field: 'step',
      message: '步进值必须是有限数值',
      code: 'NOT_FINITE',
    };
  }

  if (step <= 0) {
    return {
      field: 'step',
      message: '步进值必须大于 0',
      code: 'UNDERFLOW',
    };
  }

  if (step > 1000000) {
    return {
      field: 'step',
      message: '步进值不能超过 1000000',
      code: 'OVERFLOW',
    };
  }

  return null;
}

/**
 * 安全地增加计数器
 * @param value - 当前值
 * @param step - 步进值
 * @param config - 配置
 * @returns 新值，超出范围时返回 null
 */
export function safeIncrement(
  value: number,
  step: number = 1,
  config: Partial<CounterConfig> = {}
): number | null {
  const errors = validateCounterValue(value, config);
  if (errors.length > 0) {
    return null;
  }

  const stepError = validateStep(step);
  if (stepError) {
    return null;
  }

  const { maxValue = DEFAULT_CONFIG.maxValue } = config;
  const newValue = value + step;

  if (newValue > maxValue) {
    return null;
  }

  return newValue;
}

/**
 * 安全地减少计数器
 * @param value - 当前值
 * @param step - 步进值
 * @param config - 配置
 * @returns 新值，超出范围时返回 null
 */
export function safeDecrement(
  value: number,
  step: number = 1,
  config: Partial<CounterConfig> = {}
): number | null {
  const errors = validateCounterValue(value, config);
  if (errors.length > 0) {
    return null;
  }

  const stepError = validateStep(step);
  if (stepError) {
    return null;
  }

  const { minValue = DEFAULT_CONFIG.minValue } = config;
  const newValue = value - step;

  if (newValue < minValue) {
    return null;
  }

  return newValue;
}
