import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
	input:
		"https://schemas-openapi-buddy-swagger-ui-beta.eu-1.agent-sls.net/dev/restapi.json",
	output: {
		path: "src/api/openapi",
		format: "biome",
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
			exportFromIndex: true,
			metadata: true,
		},
	],
});
