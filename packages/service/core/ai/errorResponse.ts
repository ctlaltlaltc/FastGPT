/**
 * OpenAI-compatible 服务商错误响应归一化。
 *
 * OpenAI SDK 只从 `error` 字段读取错误信息。部分 OpenAI-compatible 服务（例如 SGLang）
 * 返回顶层 `{ object: 'error', message, code }`，且 Content-Type 可能是
 * `text/event-stream`；SDK 无法识别这种结构，最终只抛出 `400 status code (no body)`，
 * 丢失上游真实原因。这里在 fetch 边界克隆响应并解析原始文本，把非标准错误包装成
 * SDK 可识别的 `{ error: { message, type, code, param } }` 结构。
 */

type JsonObject = Record<string, unknown>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** 兼容普通 JSON、SSE `data:` 帧以及带 BOM 的错误响应。 */
const parseErrorPayload = (text: string): JsonObject | undefined => {
  const normalized = text.replace(/^\uFEFF/, '');
  const parsed = parseJson(normalized);
  if (parsed && typeof parsed === 'object') return parsed as JsonObject;

  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    const frame = parseJson(data);
    if (frame && typeof frame === 'object') return frame as JsonObject;
  }

  return undefined;
};

const getPayloadMessage = (payload: JsonObject): string | undefined => {
  const nestedError = payload.error;
  if (typeof nestedError === 'string' && nestedError.trim()) return nestedError.trim();
  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as JsonObject).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }

  for (const key of ['message', 'msg', 'errmsg', 'error_msg', 'errorMessage']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
};

const hasStandardErrorPayload = (payload: JsonObject) =>
  typeof payload.error === 'string' ||
  (!!payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error));

/**
 * 将非标准错误响应转换为 OpenAI SDK 可解析的 `{ error }` JSON。
 * 非 2xx 且无法提取 message 的响应保持原样，避免改变供应商原有语义。
 */
export const normalizeAIErrorResponse = async (response: Response): Promise<Response> => {
  if (response.ok) return response;

  const text = await response
    .clone()
    .text()
    .catch(() => '');
  if (!text.trim()) return response;

  const payload = parseErrorPayload(text);
  if (!payload || hasStandardErrorPayload(payload)) return response;

  const message = getPayloadMessage(payload);
  if (!message) return response;

  const errorPayload = {
    error: {
      message,
      type: typeof payload.type === 'string' ? payload.type : 'upstream_error',
      code: payload.code ?? null,
      param: payload.param ?? null
    }
  };

  const headers = new Headers(response.headers);
  // 原始响应可能是压缩流或 SSE，重建 body 后这些头不再成立。
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  headers.set('content-type', 'application/json');

  return new Response(JSON.stringify(errorPayload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

/** 为 OpenAI 客户端创建带错误响应归一化的 fetch。 */
export const createAIErrorNormalizingFetch = (
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): typeof globalThis.fetch => {
  return async (input, init) => normalizeAIErrorResponse(await fetchImpl(input, init));
};
