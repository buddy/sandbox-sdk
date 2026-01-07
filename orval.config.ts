import { defineConfig } from "orval";

export default defineConfig({
	sandbox: {
		input: {
			target:
				"https://schemas-openapi-buddy-swagger-ui-beta.eu-1.agent-sls.net/dev/restapi.json",
			validation: false,
			filters: {
				tags: ["Sandbox API"],
			},
		},
		output: {
			client: "zod",
			mode: "single",
			biome: true,
			target: "./src/api/schemas/sandbox-rest-api.gen.ts",
		},
	},
});
