import type { Json, Plugin } from "../contract/plugin";
import { idf } from "./idf";
import { jev } from "./jev";
import { listTags } from "./list-tags";
import { sizeLimit } from "./size-limit";

// Registry order is afterRecall order; write hooks run in parallel.
export const plugins: Plugin<Json>[] = [sizeLimit, listTags, idf, jev];
