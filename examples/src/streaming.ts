import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Command Streaming Example\n");

const identifier = "streaming-demo-sandbox";

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
		name: "Streaming Demo Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
}

log("\n=== Example 1: Auto-streaming ===");
log("Output streams to console as the command runs:\n");

await sandbox.runCommand({
	command: 'for i in 1 2 3; do echo "Line $i"; sleep 1; done',
});

log("\n=== Example 2: Custom log formatting ===");
log("Manually iterate over logs to add custom prefixes:\n");

const command = await sandbox.runCommand({
	command:
		'echo "stdout message" && echo "stderr message" >&2 && echo "another stdout"',
	detached: true,
	stdout: null,
	stderr: null,
});

for await (const entry of command.logs({ follow: true })) {
	const prefix = entry.type === "STDOUT" ? "[OUT]" : "[ERR]";
	process.stdout.write(`${prefix} ${entry.data}\n`);
}

await command.wait();

log("\nDone!");
