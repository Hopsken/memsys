import type { Json, Plugin } from "../contract/plugin";
import { listTags } from "./list-tags";
import { sizeLimit } from "./size-limit";

// Registry order is pipeline order.
export const plugins: Plugin<Json>[] = [sizeLimit, listTags];
