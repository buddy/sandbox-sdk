import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Command Streaming Example\n");

const identifier = "streaming-demo-sandbox";

// Create or get existing sandbox
log(`Getting or creating sandbox: ${identifier}`);
let sandbox: Sandbox;
try {
	sandbox = await Sandbox.get(identifier);
	log(`Found existing sandbox: ${sandbox.id}`);
} catch {
	log("Creating new sandbox...");
	sandbox = await Sandbox.create({
		identifier,
		name: "Streaming Demo Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.id}`);
}

// Example 1: Simple streaming with default stdout/stderr
log("\n=== Example 1: Simple Streaming ===");
log(
	"Running: sleep 1 && echo 'Hello from stdout' && sleep 1 && echo 'Error message' >&2",
);

await sandbox.runCommand({
	command:
		"sleep 1 && echo 'Hello from stdout' && sleep 1 && echo 'Error message' >&2",
});

// Example 2: Detached command - do other work while it runs
log("\n=== Example 2: Detached Command - Non-blocking Execution ===");
log(
	'Starting detached command: for i in 1 2 3 4 5; do echo "Count: $i"; sleep 1; done',
);

const command = await sandbox.runCommand({
	command: 'for i in 1 2 3 4 5; do echo "Count: $i"; sleep 1; done',
	detached: true,
});

log("Command started in background, continuing with other work...\n");

// Do other work while the command runs in the background
log("Doing other work (running 'hostname' command):");
await sandbox.runCommand({
	command: "hostname",
});

log("\nBack to monitoring the detached command...");
log("Streaming logs from the background command:\n");

// Now stream logs from the background command
for await (const logEntry of command.logs()) {
	const prefix = logEntry.stream === "stdout" ? "[OUT]" : "[ERR]";
	process.stdout.write(`${prefix} ${logEntry.data}`);
}

// Wait for command to complete
log("\nWaiting for background command to complete...");
const result = await command.wait();
log(`Background command finished with exit code: ${result.exitCode}`);

// Example 3: Long-running command with custom output handling
log("\n=== Example 3: Custom Output Handling ===");
log("Running: tail -f /var/log/syslog for 5 seconds");

const tailCommand = await sandbox.runCommand({
	command: "timeout 5 tail -f /var/log/syslog || true",
	detached: true,
});

let lineCount = 0;
for await (const logEntry of tailCommand.logs()) {
	if (logEntry.stream === "stdout") {
		lineCount++;
		process.stdout.write(`[Line ${lineCount}] ${logEntry.data}`);
	}
}

await tailCommand.wait();
log(`\nProcessed ${lineCount} lines of output`);

log("\nDone!");
