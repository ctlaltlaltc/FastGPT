import { describe, expect, it } from 'vitest';
import { normalizeToolCallArguments } from '@fastgpt/service/core/ai/llm/toolCall/arguments';

describe('normalizeToolCallArguments', () => {
  it('keeps a valid JSON object string unchanged', () => {
    expect(normalizeToolCallArguments('{"city":"杭州"}')).toBe('{"city":"杭州"}');
  });

  it('serializes object arguments', () => {
    expect(normalizeToolCallArguments({ city: '杭州', days: 2 })).toBe(
      '{"city":"杭州","days":2}'
    );
  });

  it('decodes double-encoded JSON string arguments', () => {
    expect(normalizeToolCallArguments(JSON.stringify(JSON.stringify({ query: 'weather' })))).toBe(
      '{"query":"weather"}'
    );
  });

  it('falls back to an empty object for empty arguments only', () => {
    expect(normalizeToolCallArguments(undefined)).toBe('{}');
    expect(normalizeToolCallArguments('')).toBe('{}');
    expect(normalizeToolCallArguments(null)).toBe('{}');
  });

  it('keeps invalid non-empty arguments unchanged', () => {
    expect(normalizeToolCallArguments('not-json')).toBe('not-json');
  });
});
