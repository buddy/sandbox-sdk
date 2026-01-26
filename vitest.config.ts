import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		include: ["tests/**/*.test.ts"],
		testTimeout: 60_000,
		fileParallelism: true,
		maxWorkers: 8,
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
			"~": resolve(__dirname, "."),
		},
	},
});
