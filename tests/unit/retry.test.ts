import { describe, expect, it } from 'vitest';
import { BridgeError, classifyHttpError, isRetryableError } from '../../src/lib/errors.js';

describe('retry classification', () => {
  it('classifies 5xx and 429 as retryable', () => {
    expect(classifyHttpError(500)).toBe('retryable');
    expect(classifyHttpError(429)).toBe('retryable');
    expect(classifyHttpError(404)).toBe('permanent');
  });

  it('detects retryable bridge errors', () => {
    expect(isRetryableError(new BridgeError('x', { errorClass: 'retryable' }))).toBe(true);
    expect(isRetryableError(new BridgeError('x', { errorClass: 'permanent' }))).toBe(false);
  });
});
