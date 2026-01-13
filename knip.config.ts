import type { KnipConfig } from "knip";

const config: KnipConfig = {
	entry: ["src/index.ts", "scripts/*.ts"],
	project: ["src/**/*.ts", "!src/api/openapi/**/*.gen.ts"],
	ignoreDependencies: ["tsx"],
	ignoreIssues: {
		"src/api/openapi/index.ts": ["exports", "types"],
	},
};

export default config;
