import { stem } from "porter2";

// An anchor is a #word inside fragment text. The worker, plugins, and client
// must find the same anchors, so all of them match with this pattern. The
// match may start one character before the `#`.
const ANCHOR = /(?:^|[^\p{L}\p{N}_/#])#(?<anchor>[\p{L}\p{N}_/-]+)/gu;

// Where each anchor sits in the text, `#` included, with its lowercase name.
export const findAnchors = (text: string) =>
  [...text.matchAll(ANCHOR)].map((match) => {
    const name = match.groups?.anchor ?? "";
    const end = match.index + match[0].length;
    return { end, name: name.toLowerCase(), start: end - name.length - 1 };
  });

export const extractAnchors = (text: string): string[] =>
  [...new Set(findAnchors(text).map(({ name }) => name))].toSorted();

// A tag covers its namespace: #project also matches #project/memsys.
export const withinTag = (anchor: string, tag: string) =>
  anchor === tag || anchor.startsWith(`${tag}/`);

// What an anchor associates through. Namespaces stay exact; other anchors
// also split on `-`, and English words are stemmed.
export const associationKeys = (anchor: string): string[] =>
  anchor.includes("/")
    ? [anchor]
    : [anchor, ...anchor.split("-").filter(Boolean)].map((word) =>
        /^[a-z]+$/u.test(word) ? stem(word) : word
      );
