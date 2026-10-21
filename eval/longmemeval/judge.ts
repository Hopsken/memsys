// Grading with DeepSeek: LongMemEval's answer check, and labels for which
// memories an answer needs.

import { z } from "zod";

import type { Question } from "./dataset.ts";

const completion = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  system_fingerprint: z.string().nullish(),
});

export const deepseek = async (model: string, prompt: string, json = false) => {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    body: JSON.stringify({
      messages: [{ content: prompt, role: "user" }],
      model,
      temperature: 0,
      ...(json && { response_format: { type: "json_object" } }),
    }),
    headers: {
      Authorization: `Bearer ${process.env["DEEPSEEK_API_KEY"] ?? ""}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`DeepSeek: ${response.status} ${await response.text()}`);
  }
  const body = completion.parse(await response.json());
  return {
    fingerprint: body.system_fingerprint ?? "",
    text: body.choices[0]?.message.content ?? "",
  };
};

// LongMemEval's answer check (src/evaluation/evaluate_qa.py), word for word.
const CHECK =
  "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.";

export const checkPrompt = (q: Question, response: string) => {
  const tail = `\n\nQuestion: ${q.question}\n\nCorrect Answer: ${q.answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
  if (q.question_id.endsWith("_abs")) {
    return `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: ${q.question}\n\nExplanation: ${q.answer}\n\nModel Response: ${response}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.`;
  }
  switch (q.question_type) {
    case "temporal-reasoning": {
      return `${CHECK} In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. ${tail}`;
    }
    case "knowledge-update": {
      return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.${tail}`;
    }
    case "single-session-preference": {
      return `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: ${q.question}\n\nRubric: ${q.answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
    }
    default: {
      return `${CHECK}${tail}`;
    }
  }
};

// Which current memories hold what the answer needs. These labels tell a
// write miss from a retrieval miss, and offline replay scores against them.
export const evidencePrompt = (q: Question, memories: Map<string, string>) =>
  `Below is everything an assistant has in long-term memory, one memory per line as ref: text. A user then asked a question with a known answer.

List the refs of the memories that hold information needed to reach that answer. A memory counts if the answer cannot be fully reached without it; leave out memories that are only on the same topic. Return {"refs": []} when no memory helps.

Question (asked ${q.question_date}): ${q.question}
Answer: ${q.answer}

Memories:
${[...memories].map(([ref, text]) => `${ref}: ${text}`).join("\n")}

Reply with JSON only: {"refs": ["..."]}`;

export const evidenceRefs = (text: string) =>
  z.object({ refs: z.array(z.string()) }).parse(JSON.parse(text)).refs;
