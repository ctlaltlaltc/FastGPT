import { describe, expect, it } from 'vitest';
import OpenAI from '@fastgpt/global/core/ai';
import {
  createAIErrorNormalizingFetch,
  normalizeAIErrorResponse
} from '@fastgpt/service/core/ai/errorResponse';

const upstreamMessage = 'Assistant tool call function.arguments must be a JSON object.';

describe('AI error response normalization', () => {
  it('keeps successful responses untouched', async () => {
    const response = new Response('ok', { status: 200 });
    await expect(normalizeAIErrorResponse(response)).resolves.toBe(response);
  });

  it('wraps top-level error payloads into the OpenAI error shape', async () => {
    const response = new Response(
      JSON.stringify({
        object: 'error',
        message: upstreamMessage,
        type: 'BadRequest',
        param: null,
        code: 400
      }),
      {
        status: 400,
        headers: { 'content-type': 'text/event-stream' }
      }
    );

    const normalized = await normalizeAIErrorResponse(response);
    expect(normalized).not.toBe(response);
    expect(normalized.status).toBe(400);
    await expect(normalized.json()).resolves.toEqual({
      error: {
        message: upstreamMessage,
        type: 'BadRequest',
        code: 400,
        param: null
      }
    });
  });

  it('parses SSE data frames in error responses', async () => {
    const response = new Response(
      `event: error\ndata: ${JSON.stringify({
        object: 'error',
        message: upstreamMessage,
        code: 400
      })}\n\n`,
      {
        status: 400,
        headers: { 'content-type': 'text/event-stream' }
      }
    );

    const normalized = await normalizeAIErrorResponse(response);
    await expect(normalized.json()).resolves.toMatchObject({
      error: { message: upstreamMessage, code: 400 }
    });
  });

  it('does not touch standard OpenAI error payloads', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'invalid api key', type: 'invalid_request_error' } }),
      {
        status: 401,
        headers: { 'content-type': 'application/json' }
      }
    );
    await expect(normalizeAIErrorResponse(response)).resolves.toBe(response);
  });

  it('surfaces the upstream message through the OpenAI SDK', async () => {
    const client = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: createAIErrorNormalizingFetch(async () => {
        return new Response(
          JSON.stringify({
            object: 'error',
            message: upstreamMessage,
            type: 'BadRequest',
            param: null,
            code: 400
          }),
          {
            status: 400,
            headers: { 'content-type': 'text/event-stream' }
          }
        );
      })
    });

    await expect(
      client.chat.completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }]
      })
    ).rejects.toMatchObject({
      message: `400 ${upstreamMessage}`,
      status: 400,
      error: { message: upstreamMessage, code: 400 }
    });
  });
});
