import { cn } from "cn";

import { TaggedText } from "@/features/tag-filter";
import { diffWords } from "@/shared/lib/diff";

// A memory's text with its #tags as links, marked up against the text before
// it when there is one and the two are close enough for a diff to read well.
export const MemoryText = ({
  before = null,
  className,
  text,
}: {
  before?: string | null;
  className?: string;
  text: string;
}) => {
  const classes = cn(
    "text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap",
    className
  );
  const diff = before === null ? null : diffWords(before, text);
  if (!diff) {
    return (
      <p className={classes}>
        <TaggedText text={text} />
      </p>
    );
  }
  // Tags link where this version has them: in its unchanged and added text.
  const after = diff
    .filter(({ kind }) => kind !== "removed")
    .map(({ text: part }) => part)
    .join("");
  let start = 0;
  return (
    <p className={classes}>
      {diff.map(({ kind, text: part }, index) => {
        const key = `${index}-${kind}`;
        if (kind === "removed") {
          return (
            <del
              className="bg-destructive/10 text-destructive decoration-destructive/60 rounded-sm"
              key={key}
            >
              {part}
            </del>
          );
        }
        const tagged = (
          <TaggedText end={start + part.length} start={start} text={after} />
        );
        start += part.length;
        if (kind === "added") {
          return (
            <ins
              className="rounded-sm bg-emerald-500/15 text-emerald-800 decoration-emerald-600/60 underline-offset-2 dark:text-emerald-300"
              key={key}
            >
              {tagged}
            </ins>
          );
        }
        return <span key={key}>{tagged}</span>;
      })}
    </p>
  );
};
