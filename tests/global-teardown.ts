import { Sandbox } from "~/src";
import { isTestSandbox, TEST_PREFIX } from "./shared/naming";

/**
 * Each scope is listed separately - the API has no "all scopes" mode. The env
 * var is read directly here, outside the setup file that moves it aside.
 */
function scopesToSweep() {
	const environment =
		process.env["BUDDY_ENVIRONMENT"] ?? process.env["BUDDY_TEST_ENVIRONMENT"];

	return [
		{ label: "project", connection: { project: process.env["BUDDY_PROJECT"] } },
		{ label: "workspace", connection: { project: undefined } },
		...(environment
			? [{ label: `environment '${environment}'`, connection: { environment } }]
			: []),
	];
}

async function cleanupTestSandboxes() {
	console.log(`\n🧹 Cleaning up '${TEST_PREFIX}' sandboxes...`);

	for (const { label, connection } of scopesToSweep()) {
		const sandboxes = await Sandbox.list({ connection }).catch(
			(error: unknown) => {
				console.log(`  ! Could not list the ${label} scope: ${String(error)}`);
				return [];
			},
		);

		const testSandboxes = sandboxes.filter(isTestSandbox);

		if (testSandboxes.length === 0) {
			console.log(`  ${label}: nothing to clean up.`);
			continue;
		}

		const results = await Promise.allSettled(
			testSandboxes.map(async (s) => {
				const sandbox = s.id ? await Sandbox.getById(s.id) : undefined;
				await sandbox?.destroy();
				return s.identifier ?? s.name;
			}),
		);

		for (const result of results) {
			if (result.status === "fulfilled") {
				console.log(`  ✓ ${label}: destroyed ${result.value}`);
			} else {
				console.log(`  ✗ ${label}: ${String(result.reason)}`);
			}
		}
	}
}

export const setup = cleanupTestSandboxes;
export const teardown = cleanupTestSandboxes;
