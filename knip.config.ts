import type { KnipConfig } from "knip";

const config: KnipConfig = {
	project: ["src/**/*.ts", "!src/api/schemas/**/*.gen.ts"],
};

export default config;
