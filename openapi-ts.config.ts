import { defineConfig } from "@hey-api/openapi-ts";

const schemaUrl = process.env["SCHEMA_URL"];

if (!schemaUrl) {
	throw new Error("SCHEMA_URL environment variable is required");
}

// Spec has dangling `$ref: '#/components/schemas/String'` on the Crawl/VisualTest
// getToken endpoints; inject a placeholder so hey-api can resolve them.
const fetchPatchedSpec = async () => {
	const response = await fetch(schemaUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${schemaUrl}: ${response.status}`);
	}
	const spec = (await response.json()) as {
		components?: { schemas?: Record<string, unknown> };
	};
	spec.components ??= {};
	spec.components.schemas ??= {};
	spec.components.schemas["String"] ??= { type: "string" };
	return spec;
};

export default defineConfig(async () => ({
	input: await fetchPatchedSpec(),
	output: {
		path: "src/api/openapi",
		postProcess: [
			{
				command: "npx",
				args: ["tsx", "scripts/cleanup-schemas.ts"],
			},
			"biome:format",
		],
	},
	parser: {
		filters: {
			tags: {
				include: ["Sandbox API", "Workspace API"],
			},
		},
	},
	plugins: [
		{
			name: "@hey-api/typescript",
			enums: "javascript",
			exportFromIndex: false,
		},
		{
			name: "zod",
			exportFromIndex: false,
		},
		{
			name: "@hey-api/transformers",
			bigInt: true,
			dates: true,
			exportFromIndex: false,
		},
	],
}));
