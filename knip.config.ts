import type { KnipConfig } from "knip";

const config: KnipConfig = {
	project: ["src/**/*.ts", "!src/api/schemas/sandbox-rest-api.gen.ts"],
};

export default config;
