import { z } from "zod";
import { callLLM } from "./llm.ts";
import {
  getFallbackDimensions,
  isScholarshipQuestion,
} from "./fallbackDimensions.ts";
import type { Dimension } from "./types.ts";

const dimensionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(120),
  importance: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  why: z.string().trim().min(1).max(500),
});

const responseSchema = z
  .object({
    dimensions: z.array(dimensionSchema).min(6).max(10),
  })
  .superRefine((value, context) => {
    const keys = value.dimensions.map((dimension) => dimension.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Dimension keys must be unique.",
        path: ["dimensions"],
      });
    }
  });

const systemPrompt =
  "You are a research methodology assistant. Given a user's research question, list the information dimensions a COMPLETE, decision-ready answer must cover. Return JSON {dimensions:[{key,label,importance,why}]}. 6 to 10 dimensions, snake_case keys. Include time-sensitive items (deadline, current cycle), cost/fees, official process, exceptions/renewal/continuation, and contact/appeal route when relevant. importance 5 means a mistake could cost money, eligibility or a missed deadline. Do not answer the question itself. JSON only.";

export async function generateDimensions(
  question: string,
  signal?: AbortSignal,
): Promise<{
  dimensions: Dimension[];
  modelUsed?: string;
  fallbackNotice?: string;
}> {
  try {
    const result = await callLLM({
      system: systemPrompt,
      prompt: `Research question:\n${question}`,
      signal,
    });
    const parsed = responseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `The model returned an invalid dimension schema: ${parsed.error.message}`,
      );
    }
    return {
      dimensions: [...parsed.data.dimensions].sort(
        (left, right) => right.importance - left.importance,
      ),
      modelUsed: result.modelUsed,
      ...(result.fallbackNotice ? { fallbackNotice: result.fallbackNotice } : {}),
    };
  } catch (error) {
    if (!isScholarshipQuestion(question)) throw error;
    return {
      dimensions: getFallbackDimensions(question),
      fallbackNotice:
        "Dimension generation was unavailable; using the built-in scholarship schema.",
    };
  }
}
