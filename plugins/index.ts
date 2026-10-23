import type { Json, Plugin } from "../contract/plugin";
import { idf } from "./idf";
import { jev } from "./jev";
import { listTags } from "./list-tags";
import { sizeLimit } from "./size-limit";

// Write hooks run in parallel; worker/recall/pipeline.ts orders recall stages.
export const plugins: Plugin<Json>[] = [sizeLimit, listTags, idf, jev];
