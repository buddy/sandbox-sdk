import { readFileSync, writeFileSync } from "node:fs";

const typesFile = "src/api/openapi/types.gen.ts";
const zodFile = "src/api/openapi/zod.gen.ts";

const dropBlocks = (content: string, pattern: RegExp) =>
	content
		.split(/\n\n/)
		.filter((block) => !pattern.test(block))
		.join("\n\n");

// TEMPORARY: the spec marks a variable's `type` as required while documenting
// it as "Defaults to `VAR` when not set", so keep it optional.
const relaxVariableType = (
	content: string,
	pattern: RegExp,
	find: RegExp,
	replacement: string,
) => {
	let patched = 0;
	const result = content
		.split(/\n\n/)
		.map((block) => {
			if (!pattern.test(block) || !find.test(block)) return block;
			patched++;
			return block.replace(find, replacement);
		})
		.join("\n\n");
	if (patched === 0) {
		console.warn(
			"Variable `type` is no longer required in the spec - drop relaxVariableType from cleanup-schemas.ts",
		);
	}
	return result;
};

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

typesContent = relaxVariableType(
	typesContent,
	/^export type AddVariableInObjectRequest(?:Writable)? = /m,
	/^(\s*)type:/m,
	"$1type?:",
);

writeFileSync(typesFile, typesContent);

let zodContent = readFileSync(zodFile, "utf8");
zodContent = dropBlocks(zodContent, /^export const zTarget/m);
zodContent = zodContent.replace(
	/z\.array\(zTargetView(?:Writable)?\)/g,
	"z.array(z.unknown())",
);

zodContent = relaxVariableType(
	zodContent,
	/^export const zAddVariableInObjectRequest(?:Writable)? = /m,
	/^(\s*type: z\.enum\(\[[^\]]*\]\)),$/m,
	"$1.optional(),",
);

writeFileSync(zodFile, zodContent);

console.log("Cleaned up generated schemas");
