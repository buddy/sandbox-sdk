import { Sandbox } from "~/src";
import { isTestSandbox, TEST_NAME_PREFIX } from "./shared/naming";
import {
	projectEnvironmentConnection,
	workspaceConnection,
	workspaceEnvironmentConnection,
} from "./shared/scope";

function scopesToSweep() {
	return [
		{ label: "project", connection: { project: process.env["BUDDY_PROJECT"] } },
		{ label: "workspace", connection: { scope: "WORKSPACE" as const } },
		{ label: "test workspace", connection: workspaceConnection },
		{
			label: "workspace environment",
			connection: workspaceEnvironmentConnection,
		},
		{ label: "project environment", connection: projectEnvironmentConnection },
	].filter((scope) => scope.connection !== undefined);
}

async function cleanupTestSandboxes() {
	console.log(`\n🧹 Cleaning up '${TEST_NAME_PREFIX}' sandboxes...`);

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
