import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** Vercel AI Gateway if its key is set, otherwise Anthropic directly. */
export function model(): LanguageModel {
  const id = process.env.AGENT_MODEL ?? "claude-haiku-5-5";
  if (process.env.AI_GATEWAY_API_KEY) return id.includes("/") ? id : `anthropic/${id}`;
  if (process.env.ANTHROPIC_API_KEY) return createAnthropic()(id.replace(/^anthropic\//, ""));
  throw new Error("No AI key: set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY in web/.env.local");
}

export const hasAiKey = () => Boolean(process.env.AI_GATEWAY_API_KEY || process.env.ANTHROPIC_API_KEY);
