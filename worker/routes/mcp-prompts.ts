export const SERVER_INSTRUCTIONS = `Memsys is long-term fragment memory.

Store durable information as small, atomic, self-contained fragments rather than summaries, transcripts, or reasoning traces. Keep fragments concise and split independent ideas into separate memories.

Use #anchors for stable entities or concepts that should link related fragments. Fragments with similar anchors are considered associated and are returned together by recall.

Recall with short textual cues such as distinctive phrases, names, projects, concepts, or #anchors. A cue is free text and may combine several words, alternatives included: a memory matches when it contains any of them, and memories with more and rarer words come first. Give every angle you need in one call, one cue per angle, such as different facets of the question or different wordings. Call recall again only if what came back is not enough.`;

const FRAGMENT_PARAMETER =
  "One atomic text fragment. Keep it short: a few sentences at most. Long fragments may be warned about or rejected.";

export const TOOLS = {
  remember: {
    description:
      "Store one durable, independently recallable memory fragment. Keep it atomic, self-contained, and concise. Split multiple ideas into separate fragments. Use #anchors to link related memories.",
    parameters: {
      fragment: FRAGMENT_PARAMETER,
    },
  },

  recall: {
    description:
      "Recall memories using short textual cues, one per angle. Prefer distinctive phrases, entities, concepts, or #anchors. Fragments matching the cues come first, and fragments matching several cues rank higher; fragments with `via` were associated through the listed shared #anchors. `truncated: true` means some matching memories were left out: recall again with more specific cues, or with an #anchor from `via`.",
    parameters: {
      context:
        "What you are working on right now. Give it whenever you have a task: it helps pick the memories that matter for it.",
      cues: "What you need, one cue per angle. Each cue is a few distinctive words, a phrase, or #anchors.",
    },
  },

  list_tags: {
    description: "List all #anchor names currently used.",
  },

  revise: {
    description:
      "Replace the full text of a known memory when its information has changed or needs correction. Keep the replacement atomic and self-contained.",
    parameters: {
      fragment: FRAGMENT_PARAMETER,
    },
  },

  forget: {
    description:
      "Delete a known memory that is obsolete, incorrect, duplicated, or explicitly requested to be forgotten.",
  },
} as const;
