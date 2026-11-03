import { getNanoid, sliceJsonStr } from '@fastgpt/global/common/string/tools';
import json5 from 'json5';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool
} from '@fastgpt/global/core/ai/llm/type';
import { normalizeToolCallArguments } from '../toolCall/arguments';
import { getPromptToolCallPrompt } from './prompt';
import { cloneDeep } from 'lodash-es';

export const promptToolCallMessageRewrite = (
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[]
) => {
  const cloneMessages = cloneDeep(messages);

  // Add system prompt too messages
  let systemMessage = cloneMessages.find(
    (item) => item.role === 'system'
  ) as ChatCompletionSystemMessageParam;

  if (!systemMessage) {
    systemMessage = {
      role: 'system',
      content: ''
    };
    cloneMessages.unshift(systemMessage);
  }

  if (typeof systemMessage?.content === 'string') {
    systemMessage.content =
      `${systemMessage.content}\n\n${getPromptToolCallPrompt(tools.map((tool) => tool.function))}`.trim();
  } else if (Array.isArray(systemMessage.content)) {
    systemMessage.content.push({
      type: 'text',
      text: getPromptToolCallPrompt(tools.map((tool) => tool.function))
    });
  } else {
    throw new Error('Prompt call invalid input');
  }

  /* 
    Format tool messages, rewrite assistant/tool message
    1. Assistant, not tool_calls: skip
    2. Assistant, tool_calls: rewrite to assistant text
    3. Tool: rewrite to user text
  */
  for (let i = 0; i < cloneMessages.length; i++) {
    const message = cloneMessages[i];
    if (message.role === 'assistant') {
      if (message.content && typeof message.content === 'string') {
        message.content = `0: ${message.content}`;
      } else if (message.tool_calls?.length) {
        message.content = `1: ${JSON.stringify({
          ...message.tool_calls[0].function,
          arguments: normalizeToolCallArguments(message.tool_calls[0].function.arguments)
        })}`;
        delete message.tool_calls;
      }
    } else if (message.role === 'tool') {
      cloneMessages.splice(i, 1, {
        role: 'user',
        content: `<ToolResponse>\n${message.content}\n</ToolResponse>`
      });
    }
  }

  return cloneMessages;
};

/**
 * prompt 模式的模型输出经过 json5 解析后，arguments 可能是对象，也可能是 JSON 字符串。
 * 对象按原逻辑序列化；JSON 字符串需要在保留旧行为（null、非 JSON 字符串）的同时，
 * 处理「字符串里还是对象 JSON」的二次编码场景。
 */
const stringifyPromptToolArguments = (args: unknown): string => {
  if (args === null) return 'null';

  if (typeof args === 'string') {
    const normalized = normalizeToolCallArguments(args);
    const trimmed = args.trim();
    if (normalized === '{}' && trimmed !== '' && trimmed !== '{}') {
      return JSON.stringify(args);
    }
    return normalized;
  }

  return JSON.stringify(args);
};

const ERROR_TEXT = 'Tool call error';
export const parsePromptToolCall = (
  str: string
): {
  answer: string;
  streamAnswer?: string;
  toolCalls?: ChatCompletionMessageToolCall[];
} => {
  str = str.trim();
  // 首先，使用正则表达式提取TOOL_ID和TOOL_ARGUMENTS
  const prefixReg = /1(:|：)/;

  if (prefixReg.test(str)) {
    const toolString = sliceJsonStr(str);

    try {
      const toolCall = json5.parse(toolString) as { name: string; arguments: unknown };

      return {
        answer: '',
        toolCalls: [
          {
            id: getNanoid(),
            type: 'function' as const,
            function: {
              name: toolCall.name,
              arguments: stringifyPromptToolArguments(toolCall.arguments)
            }
          }
        ]
      };
    } catch (error) {
      if (prefixReg.test(str)) {
        return {
          answer: `${ERROR_TEXT}: ${str}`,
          streamAnswer: `${ERROR_TEXT}: ${str}`
        };
      } else {
        return {
          answer: str,
          streamAnswer: str
        };
      }
    }
  } else {
    const firstIndex = str.indexOf('0:') !== -1 ? str.indexOf('0:') : str.indexOf('0：');
    if (firstIndex > -1 && firstIndex < 6) {
      str = str.substring(firstIndex + 2).trim();
    }

    return { answer: str };
  }
};
