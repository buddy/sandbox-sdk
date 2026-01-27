import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Error Handling Example\n");

const identifier = "error-handling-dev-sandbox";

log(`Getting or creating sandbox: ${identifier}`);

let sandbox: Sandbox;

try {
	sandbox = await Sandbox.getByIdentifier(identifier);
	log(
		`Found existing sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`,
	);
} catch {
	log("Creating new sandbox...");
	sandbox = await Sandbox.create({
		identifier,
		name: "Error Handling Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
}

log("Starting sandbox...");
await sandbox.start();

// Example 1: Basic exit code check
log("\n=== Example 1: Basic exit code check ===");
log("Running: ls /nonexistent-directory\n");

const result1 = await sandbox.runCommand({
	command: "ls /nonexistent-directory",
});

if (result1.data.exit_code !== 0) {
	log(`Command failed with exit code ${result1.data.exit_code}`);
}

// Example 2: Capture stderr for error details
log("\n=== Example 2: Capture stderr ===");
log("Running: cat /file/that/does/not/exist\n");

const result2 = await sandbox.runCommand({
	command: "cat /file/that/does/not/exist",
	stdout: null,
	stderr: null,
});

if (result2.data.exit_code !== 0) {
	const errorOutput = await result2.stderr();
	log(`Command failed: ${errorOutput.trim()}`);
}

// Example 3: Throw on failure (wrapper pattern)
log("\n=== Example 3: Throw on failure ===");
log("Running: false (always exits with 1)\n");

async function runOrThrow(
	sandbox: Sandbox,
	command: string,
): Promise<Awaited<ReturnType<Sandbox["runCommand"]>>> {
	const result = await sandbox.runCommand({ command, stdout: null, stderr: null });
	if (result.data.exit_code !== 0) {
		const stderr = await result.stderr();
		throw new Error(`Command "${command}" failed: ${stderr.trim()}`);
	}
	return result;
}

try {
	await runOrThrow(sandbox, "false");
} catch (err) {
	log(`Caught error: ${err instanceof Error ? err.message : err}`);
}

// Example 4: Expected failures (like grep with no matches)
log("\n=== Example 4: Expected failures ===");
log("Running: echo 'hello world' | grep 'nonexistent'\n");

const grepResult = await sandbox.runCommand({
	command: "echo 'hello world' | grep 'nonexistent'",
	stdout: null,
	stderr: null,
});

// grep returns 1 when no matches - this is expected, not an error
if (grepResult.data.exit_code === 1) {
	log("No matches found (expected)");
} else if (grepResult.data.exit_code === 0) {
	log("Found matches");
} else {
	log(`Unexpected grep error: exit code ${grepResult.data.exit_code}`);
}

log("\nStopping sandbox...");
await sandbox.stop();

log("Error handling example completed!");