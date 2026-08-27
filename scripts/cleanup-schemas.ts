import { readFileSync, writeFileSync } from "node:fs";

const typesFile = "src/api/openapi/types.gen.ts";
const zodFile = "src/api/openapi/zod.gen.ts";

const dropBlocks = (content: string, pattern: RegExp) =>
	content
		.split(/\n\n/)
		.filter((block) => !pattern.test(block))
		.join("\n\n");

/*
 * The patches below work around two places where the published spec disagrees
 * with the API: environment IDs are hashid strings typed as int32, and
 * `POST /sandboxes` accepts `scope`/`environment` in the body while
 * documenting three records declaring neither. Both are reported upstream.
 * Each patch throws once it stops applying, so the next regeneration fails
 * loudly rather than keeping a stale workaround.
 */

const REPORT = "check whether the spec still needs this workaround";

/** Replace a generated block, insisting that the patch still has an effect */
function patchBlock(
	content: string,
	pattern: RegExp,
	transform: (block: string) => string,
	what: string,
): string {
	const block = content.match(pattern)?.[0];

	if (!block) {
		throw new Error(
			`Patch target no longer exists: ${what}. The generated shape changed - re-check whether the workaround is still needed (${REPORT}).`,
		);
	}

	const patched = transform(block);

	if (patched === block) {
		throw new Error(
			`Patch is now a no-op: ${what}. This most likely means the backend fixed the spec - delete the workaround (${REPORT}).`,
		);
	}

	return content.replace(block, patched);
}

/**
 * Append fields to a generated declaration. The generator leaves no trailing
 * comma after the last property, so zod schemas need one supplied; TypeScript
 * members are semicolon-terminated already. Biome reindents afterwards.
 */
function appendFields(
	block: string,
	closing: "});" | "};",
	fields: string,
): string {
	const end = block.lastIndexOf(`\n${closing}`);
	const head = block.slice(0, end);
	const separator = closing === "});" && /[^,{[\s]\s*$/.test(head) ? "," : "";

	return `${head}${separator}\n${fields}${closing}`;
}

const zodObject = (name: string) =>
	new RegExp(`export const ${name} = z\\.object\\(\\{[\\s\\S]*?\\n\\}\\);`);

const typeAlias = (name: string) =>
	new RegExp(`export type ${name} = \\{[\\s\\S]*?\\n\\};`);

/**
 * The environment reference accepted by `POST /sandboxes`. Inlined rather than
 * referencing `zShortEnvironmentViewWritable`, which is emitted further down
 * the file and would hit the temporal dead zone on import.
 */
const ENVIRONMENT_ZOD_FIELDS = `	scope: z.enum(["PROJECT", "ENVIRONMENT", "WORKSPACE"]).optional(),
	environment: z
		.object({
			id: z.string().optional(),
			identifier: z.string().optional(),
			name: z.string().optional(),
		})
		.optional(),
`;

const ENVIRONMENT_TYPE_FIELDS = `	/**
	 * The scope of the sandbox: PROJECT, ENVIRONMENT, or WORKSPACE
	 */
	scope?: "PROJECT" | "ENVIRONMENT" | "WORKSPACE";
	/**
	 * The environment the sandbox belongs to (required when scope is \`ENVIRONMENT\`)
	 */
	environment?: {
		id?: string;
		identifier?: string;
		name?: string;
	};
`;

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

let zodContent = readFileSync(zodFile, "utf8");
zodContent = dropBlocks(zodContent, /^export const zTarget/m);
zodContent = zodContent.replace(
	/z\.array\(zTargetView(?:Writable)?\)/g,
	"z.array(z.unknown())",
);

// Patch 1: hashid strings typed as int32 - unpatched, response validation
// rejects every environment-scoped sandbox.
for (const name of ["zShortEnvironmentView", "zShortEnvironmentViewWritable"]) {
	zodContent = patchBlock(
		zodContent,
		zodObject(name),
		(block) =>
			block.replace(
				/(^|\n)\s*id: z[\s\S]*?\.int\(\)[\s\S]*?\.optional\(\),/,
				"$1\tid: z.string().optional(),",
			),
		`${name}.id should be a string (hashid), not an int32`,
	);
}

for (const name of ["ShortEnvironmentView", "ShortEnvironmentViewWritable"]) {
	typesContent = patchBlock(
		typesContent,
		typeAlias(name),
		(block) => block.replace(/(^|\n)\s*id\?: number;/, "$1\tid?: string;"),
		`${name}.id should be a string (hashid), not a number`,
	);
}

// Patch 2: the create body really does take scope/environment. Unpatched, our
// own request validation strips them before the call leaves the process.
const bodyUnion = zodContent.match(
	/export const zAddSandboxBody = z\.union\(\[([\s\S]*?)\]\);/,
)?.[1];

if (!bodyUnion) {
	throw new Error(
		`Cannot find the zAddSandboxBody union - the create-sandbox body shape changed (${REPORT}).`,
	);
}

const bodySchemas = bodyUnion
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean);

if (bodySchemas.length === 0) {
	throw new Error(
		`The zAddSandboxBody union is empty - nothing to patch (${REPORT}).`,
	);
}

for (const schema of bodySchemas) {
	zodContent = patchBlock(
		zodContent,
		zodObject(schema),
		(block) =>
			/(^|\n)\s*scope:/.test(block)
				? block
				: appendFields(block, "});", ENVIRONMENT_ZOD_FIELDS),
		`${schema} is missing scope/environment`,
	);

	// zCloneSandboxRequest -> CloneSandboxRequest
	const type = schema.replace(/^z/, "");

	typesContent = patchBlock(
		typesContent,
		typeAlias(type),
		(block) =>
			/(^|\n)\s*scope\?:/.test(block)
				? block
				: appendFields(block, "};", ENVIRONMENT_TYPE_FIELDS),
		`${type} is missing scope/environment`,
	);
}

writeFileSync(typesFile, typesContent);
writeFileSync(zodFile, zodContent);

console.log(
	`Cleaned up generated schemas (patched ${bodySchemas.length} create-sandbox body schemas)`,
);
