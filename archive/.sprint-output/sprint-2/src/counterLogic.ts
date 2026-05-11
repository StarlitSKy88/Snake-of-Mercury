/**
 * 计数器业务逻辑
 * 包含完整的输入验证和边界处理
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CounterLogic {
  private readonly maxValue: number;
  private readonly minValue: number;
  private readonly MAX_SAFE_VALUE = 999999;
  private readonly MIN_SAFE_VALUE = 0;

  constructor(maxValue: number = 999999, minValue: number = 0) {
    if (!Number.isFinite(maxValue) || maxValue < 0) {
      throw new ValidationError('最大值配置无效');
    }
    if (!Number.isFinite(minValue) || minValue < 0) {
      throw new ValidationError('最小值配置无效');
    }
    this.maxValue = Math.min(maxValue, this.MAX_SAFE_VALUE);
    this.minValue = Math.max(minValue, this.MIN_SAFE_VALUE);
  }

  /**
   * 验证数值是否有效
   */
  private validateValue(value: number, operation: string): void {
    // 类型验证
    if (typeof value !== 'number') {
      throw new ValidationError(`${operation}失败：值必须是数字类型`);
    }

    // NaN 检测
    if (Number.isNaN(value)) {
      throw new ValidationError(`${operation}失败：值不能是 NaN`);
    }

    // Infinity 检测
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${operation}失败：值不能是无穷大`);
    }

    // 负数检测（计数器不能为负）
    if (value < 0) {
      throw new ValidationError(`${operation}失败：计数器不能为负数`);
    }

    // 超过最大安全值
    if (value > this.MAX_SAFE_VALUE) {
      throw new ValidationError(`${operation}失败：值超出最大限制 (${this.MAX_SAFE_VALUE})`);
    }
  }

  /**
   * 验证步进值
   */
  private validateStep(step: number): void {
    if (typeof step !== 'number' || Number.isNaN(step) || !Number.isFinite(step)) {
      throw new ValidationError('步进值必须是有限数字');
    }
    if (step <= 0) {
      throw new ValidationError('步进值必须大于 0');
    }
  }

  /**
   * 增加计数
   */
  increment(value: number, step: number = 1): number {
    this.validateValue(value, '增加');
    this.validateStep(step);

    // 检查是否会超出最大值
    const result = value + step;
    
    if (result > this.maxValue) {
      throw new ValidationError(`已达到最大值 (${this.maxValue})，无法继续增加`);
    }

    return result;
  }

  /**
   * 减少计数
   */
  decrement(value: number, step: number = 1): number {
    this.validateValue(value, '减少');
    this.validateStep(step);

    const result = value - step;

    if (result < this.minValue) {
      throw new ValidationError(`已达到最小值 (${this.minValue})，无法继续减少`);
    }

    return result;
  }

  /**
   * 重置计数
   */
  reset(): number {
    return this.minValue;
  }

  /**
   * 设置特定值
   */
  setValue(value: number): number {
    this.validateValue(value, '设置');

    if (value > this.maxValue) {
      throw new ValidationError(`值不能超过最大值 (${this.maxValue})`);
    }

    if (value < this.minValue) {
      throw new ValidationError(`值不能小于最小值 (${this.minValue})`);
    }

    return value;
  }

  /**
   * 获取当前配置
   */
  getConfig(): { maxValue: number; minValue: number } {
    return {
      maxValue: this.maxValue,
      minValue: this.minValue
    };
  }

  /**
   * 检查值是否在有效范围内
   */
  isInRange(value: number): boolean {
    try {
      this.validateValue(value, '检查');
      return value >= this.minValue && value <= this.maxValue;
    } catch {
      return false;
    }
  }
}
