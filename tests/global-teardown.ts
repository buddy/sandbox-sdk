import { Sandbox } from "~/src";
import { createClient } from "~/src/utils/client";
import { isTestSandbox, TEST_NAME_PREFIX } from "./shared/naming";
import {
	projectEnvironmentConnection,
	workspaceConnection,
	workspaceEnvironmentConnection,
} from "./shared/scope";

function scopesToSweep() {
	return [
		{ label: "project", connection: { project: process.env["BUDDY_PROJECT"] } },
		{
			label: "workspace",
			connection: { workspace: process.env["BUDDY_WORKSPACE"] },
		},
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

		const client = createClient(connection);
		const results = await Promise.allSettled(
			testSandboxes.map(async (s) => {
				if (s.id) {
					await client.deleteSandboxById({ path: { id: s.id } });
				}
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
