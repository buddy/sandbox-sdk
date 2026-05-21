import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		include: ["tests/**/*.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		fileParallelism: true,
		maxWorkers: 8,
		globalSetup: ["./tests/global-teardown.ts"],
		reporters: ["default", "@buddy-works/unit-tests/vitest"],
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
			"~": resolve(__dirname, "."),
		},
	},
});
