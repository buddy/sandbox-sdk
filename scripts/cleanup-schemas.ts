import { readFileSync, writeFileSync } from "node:fs";

const typesFile = "src/api/openapi/types.gen.ts";
const zodFile = "src/api/openapi/zod.gen.ts";

// Drop Target* types. hey-api emits the discriminated union with a circular
// `Omit<TargetView, "type"> & {...}` pattern that TypeScript rejects (TS2456).
// These types are pulled in transitively via PipelineEventView.targets and
// are not referenced by any SDK surface, so we delete every Target* type and
// widen the one reference to `unknown`.
const dropBlocks = (content: string, pattern: RegExp) =>
	content
		.split(/\n\n/)
		.filter((block) => !pattern.test(block))
		.join("\n\n");

let typesContent = readFileSync(typesFile, "utf8");

// Remove ClientOptions type from types.gen.ts (contains hardcoded base URL)
typesContent = typesContent.replace(
	/export type ClientOptions[\s\S]*?^};\n\n/m,
	"",
);

typesContent = dropBlocks(typesContent, /^export type Target/m);
typesContent = typesContent.replace(
	/Array<TargetView(?:Writable)?>/g,
	"Array<unknown>",
);

writeFileSync(typesFile, typesContent);

let zodContent = readFileSync(zodFile, "utf8");
zodContent = dropBlocks(zodContent, /^export const zTarget/m);
zodContent = zodContent.replace(
	/z\.array\(zTargetView(?:Writable)?\)/g,
	"z.array(z.unknown())",
);

writeFileSync(zodFile, zodContent);

console.log("Cleaned up generated schemas");
