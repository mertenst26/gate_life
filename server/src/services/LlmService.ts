import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function llmChat(
  systemPrompt: string,
  messages: LlmMessage[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.8,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.text ?? '';
}
