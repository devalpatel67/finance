import OpenAI from "openai";
import { env } from "@/lib/env";

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": env.BETTER_AUTH_URL,
    "X-Title": "Tabula",
  },
});
