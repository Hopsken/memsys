export const SERVER_INSTRUCTIONS = `Memsys is one person's long-term memory, shared by all their agents.

Call \`recall\` before a task that depends on what the person has said, chosen, or learned before; it answers in prose. Call \`note\` when a conversation produces something worth keeping; memory decides what to add, revise, or forget and replies with a short receipt. Both run synchronously.`;

export const TOOLS = {
  note: {
    description:
      "Hand over conversation context worth keeping. Memory decides what to add, change, or forget, and replies with a short receipt.",
    parameters: {
      context:
        "What happened in this conversation that memory might need: what the user said, chose, or corrected, and what you learned.",
    },
  },

  recall: {
    description:
      "Ask what memory holds for your current task. Answers in prose, from the user's own memories; it never changes them.",
    parameters: {
      context:
        "What you are working on right now, in enough detail for memory to know what matters.",
    },
  },
} as const;
