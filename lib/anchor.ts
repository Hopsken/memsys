import { stemPlainEnglish } from "./analyzer";

const ANCHOR = /(?<=^|[^\p{L}\p{N}_/#])#(?<anchor>[\p{L}\p{N}_/-]+)/gu;

export const findAnchors = (text: string) =>
  [...text.matchAll(ANCHOR)].map((match) => {
    const name = match.groups?.anchor ?? "";
    const start = match.index;
    return { end: start + match[0].length, name: name.toLowerCase(), start };
  });

export const extractAnchors = (text: string): string[] =>
  [...new Set(findAnchors(text).map(({ name }) => name))].toSorted();

export const withinTag = (anchor: string, tag: string) =>
  anchor === tag || anchor.startsWith(`${tag}/`);

const isNamespaced = (anchor: string) => anchor.includes("/");

export const associationKeys = (anchor: string): string[] =>
  isNamespaced(anchor)
    ? [anchor]
    : [anchor, ...anchor.split("-").filter(Boolean)].map(stemPlainEnglish);
