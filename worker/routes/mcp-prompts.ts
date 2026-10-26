export const SERVER_INSTRUCTIONS = `Memsys is one person's long-term memory, shared by all their agents. Fragments are short, atomic, self-contained; #anchors link related ones.

Store what no other source keeps: what the user said, chose, or prefers; decisions and why; lessons; corrections. Do not copy a source you can reread (code, docs, a tool): store the conclusion and where it lives.

Recall with short cues, one per angle, in one call. When a recalled memory turns out wrong or outdated, revise it instead of adding a contradicting one.`;

const FRAGMENT_PARAMETER =
  "One atomic fragment, a few sentences at most; longer ones may be warned about or rejected.";

export const TOOLS = {
  remember: {
    description:
      "Store one memory: what the user told you or this conversation produced, not a copy of something you can reread. Make it stand alone, in words a future cue would use. One idea per fragment; #anchors link related ones.",
    parameters: {
      fragment: FRAGMENT_PARAMETER,
    },
  },

  recall: {
    description:
      "Recall memories with short cues, one per angle. `by` names who last wrote a memory's text: `user` is the person, any other name is one of their agents; it says who wrote it down, not who said it. `via` lists the #anchors a memory was associated through. `truncated: true` means some matches were left out: recall again with narrower cues or an #anchor from `via`.",
    parameters: {
      context:
        "What you are working on right now. Give it whenever you have a task: it helps pick the memories that matter for it.",
      cues: "One cue per angle: distinctive words, a phrase, or #anchors. Alternative wordings share a cue; different facets get their own.",
    },
  },

  list_tags: {
    description:
      "List every #anchor in use. Reuse one when writing; recall by one when words alone miss.",
  },

  revise: {
    description:
      "Replace a memory, by ref, when it is wrong or outdated. Keep what still holds and say what changed.",
    parameters: {
      fragment: FRAGMENT_PARAMETER,
    },
  },

  forget: {
    description:
      "Delete a memory by ref when it is wrong beyond revising, a duplicate (keep one), or the user asked to forget it.",
  },
} as const;
