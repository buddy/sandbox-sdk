import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Command Exec Example\n");

const identifier = "exec-demo-sandbox";

log(`Getting or creating sandbox: ${identifier}`);

let sandbox: Sandbox;

try {
	sandbox = await Sandbox.getByIdentifier(identifier);
	log(
		`Found existing sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`,
	);
	await sandbox.start();
} catch {
	log("Creating new sandbox...");
	sandbox = await Sandbox.create({
		identifier,
		name: "Exec Demo Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
	await sandbox.waitUntilRunning();
}

try {
	log("\n=== Example 1: Output and exit code in one call ===");

	const hello = await sandbox.exec({
		command: "echo 'Hello from the sandbox'",
	});

	log(`Exit code: ${hello.exit_code}`);
	log(`Stdout: ${hello.stdout?.trim()}`);

	log("\n=== Example 2: A failing command still resolves ===");
	log("Check exit_code to see how it went:\n");

	const failed = await sandbox.exec({
		command: "echo 'something broke' >&2 && exit 3",
	});

	log(`Exit code: ${failed.exit_code}`);
	log(`Stderr: ${failed.stderr?.trim()}`);

	if (failed.exit_code !== 0) {
		log("Handled the failure without a try/catch.");
	}

	log("\n=== Example 3: Another runtime ===");

	const python = await sandbox.exec({
		command: "print('computed in python:', 6 * 7)",
		runtime: "PYTHON",
	});

	log(`Stdout: ${python.stdout?.trim()}`);

	log("\n=== Example 4: When to reach for runCommand() instead ===");
	log("exec() is capped at 60 seconds and keeps no history or logs.");
	log("Streaming output as it arrives needs runCommand():\n");

	await sandbox.runCommand({
		command: 'for i in 1 2 3; do echo "Line $i"; sleep 1; done',
	});
} finally {
	log("\nStopping sandbox...");
	await sandbox.stop().catch(() => undefined);
	log("Exec example completed!");
}
