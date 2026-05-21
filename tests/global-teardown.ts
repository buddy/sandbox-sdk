import { Sandbox } from "~/src";

async function cleanupTestSandboxes() {
	console.log("\n🧹 Cleaning up test sandboxes...");

	const sandboxes = await Sandbox.list();
	const testSandboxes = sandboxes.filter(
		(s) =>
			s.name?.startsWith("Sandbox 202") ||
			s.name?.startsWith("test-") ||
			s.name?.startsWith("command-test-") ||
			s.name?.startsWith("filesystem-test-") ||
			s.name?.startsWith("fbc-probe-") ||
			s.name?.startsWith("resources-probe-") ||
			s.name?.startsWith("update-probe-"),
	);

	if (testSandboxes.length === 0) {
		console.log("No test sandboxes to clean up.");
		return;
	}

	console.log(`Found ${testSandboxes.length} test sandbox(es) to clean up.`);

	const results = await Promise.allSettled(
		testSandboxes.map(async (s) => {
			const sandbox = s.id ? await Sandbox.getById(s.id) : undefined;
			await sandbox?.destroy();
			return s.name;
		}),
	);

	for (const result of results) {
		if (result.status === "fulfilled") {
			console.log(`  ✓ Destroyed: ${result.value}`);
		} else {
			console.log(`  ✗ Failed to destroy: ${result.reason}`);
		}
	}
}

export const setup = cleanupTestSandboxes;
export const teardown = cleanupTestSandboxes;
