/**
 * 归一化 assistant tool_calls 的 arguments，保证回传给 OpenAI-compatible 服务时是
 * 「JSON 字符串，解析后为对象」。
 *
 * 部分模型（尤其 prompt tool 模式）会把 arguments 输出成 JSON 字符串，解析后仍为字符串，
 * 直接 JSON.stringify 会二次编码；SGLang 等实现会校验失败：
 * Assistant tool call function.arguments must be a JSON object.
 */
export const normalizeToolCallArguments = (args: unknown): string => {
  if (typeof args !== 'string') {
    if (args === undefined || args === null) return '{}';
    if (typeof args === 'object') return JSON.stringify(args);
    return String(args);
  }

  const text = args.trim();
  if (!text) return '{}';

  try {
    const parsed = JSON.parse(text);

    // 正常对象 JSON 字符串：保留原文（含空格和字段顺序）。
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return text;

    // 二次编码：第一次解析结果仍是字符串，再解析得到对象。
    if (typeof parsed === 'string') {
      const nested = JSON.parse(parsed);
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return JSON.stringify(nested);
      }
    }
  } catch {
    // 非 JSON 字符串保持原样，不静默丢弃模型输出。
  }

  return args;
};
