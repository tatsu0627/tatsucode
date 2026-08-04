import "server-only";

import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
