import OpenAI from "openai";
import { z } from "zod";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatComplete = (messages: ChatMessage[]) => Promise<string>;

const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-v4-flash";

/**
 * A `complete` fn backed by DeepSeek through the OpenAI SDK. json_object mode +
 * temperature 0 for determinism (the prompt must contain the word "json"). The
 * API key is read lazily so unit tests never need it — they inject a fake complete.
 */
export function deepSeekComplete(): ChatComplete {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const client = new OpenAI({ baseURL: BASE_URL, apiKey });
  return async (messages) => {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0,
    });
    return res.choices[0]?.message?.content ?? "";
  };
}

/**
 * Call the model and parse strictly into `schema`. The model free-texts enums, so
 * on any Zod failure we re-ask with the validation error (temperature 0 means the
 * correction itself must change the output) up to `retries` times. Throws if it
 * still doesn't conform — invalid model output never flows downstream.
 */
export async function callStructured<T>(
  complete: ChatComplete,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  retries = 2,
): Promise<T> {
  const convo: ChatMessage[] = [...messages];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await complete(convo);
    const parsed = safeJson(raw);
    if (parsed === undefined) {
      convo.push({ role: "assistant", content: raw });
      convo.push({ role: "user", content: "That was not valid json. Reply again with valid json only." });
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    convo.push({ role: "assistant", content: raw });
    convo.push({
      role: "user",
      content: `That json failed validation: ${formatIssues(result.error)}. Reply again with corrected json only.`,
    });
  }
  throw new Error(`Model response failed schema validation after ${retries + 1} attempts`);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
}
