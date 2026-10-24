import type { Memory } from "@core";

import type { Author, Fragment } from "@contract/memory";
import { err, ok } from "@contract/result";
import type { InvalidInput, NotFound, Result } from "@contract/result";

import type { TooLong } from "../errors";
import { checkLength, readSettings } from "./settings";

export type Written = Fragment & { warnings?: string[] };

const write = async <E>(
  memory: Pick<Memory, "readMetadata">,
  text: string,
  store: () => Promise<Result<Fragment, E>> | Result<Fragment, E>
): Promise<Result<Written, E | TooLong>> => {
  const { length } = await readSettings(memory);
  const checked = checkLength(length, text);
  if (!checked.ok) {
    return checked;
  }
  const stored = await store();
  if (!stored.ok) {
    return err(stored.error);
  }
  return ok(
    checked.value === null
      ? stored.value
      : { ...stored.value, warnings: [checked.value] }
  );
};

export const remember = (
  memory: Memory,
  input: { fragment: string },
  by: Author
): Promise<Result<Written, InvalidInput | TooLong>> =>
  write(memory, input.fragment, () => memory.remember(input, by));

export const revise = (
  memory: Memory,
  input: { fragment: string; ref: string },
  by: Author
): Promise<Result<Written, InvalidInput | NotFound | TooLong>> =>
  write(memory, input.fragment, () => memory.revise(input, by));

export const listTags = async (memory: Pick<Memory, "anchors">) => {
  const anchors = await memory.anchors();
  return anchors.map(({ anchor }) => anchor);
};
