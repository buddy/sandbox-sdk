import type { KnipConfig } from "knip";

const config: KnipConfig = {
	entry: ["src/index.ts", "scripts/*.ts"],
	project: ["src/**/*.ts", "!src/api/schemas/**/*.gen.ts"],
	ignoreDependencies: ["tsx"],
	ignoreIssues: {
		"src/api/schemas/index.ts": ["exports", "types"],
	},
};

export default config;
