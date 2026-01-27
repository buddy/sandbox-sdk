import { defineConfig } from "@hey-api/openapi-ts";

const schemaUrl = process.env["SCHEMA_URL"];

if (!schemaUrl) {
	throw new Error("SCHEMA_URL environment variable is required");
}

export default defineConfig({
	input: schemaUrl,
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
				include: ["Sandbox API"],
			},
		},
	},
	plugins: [
		{
			name: "@hey-api/typescript",
			enums: "javascript",
			exportFromIndex: true,
		},
		{
			name: "zod",
			metadata: true,
			exportFromIndex: true,
		},
		{
			name: "@hey-api/transformers",
			bigInt: true,
			dates: true,
			exportFromIndex: true,
		},
	],
});
