import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Sandbox Lifecycle Example\n");

const identifier = "lifecycle-demo-sandbox";

// Create or get existing sandbox
log(`Creating sandbox with identifier: ${identifier}`);
const sandbox = await Sandbox.create({
	identifier,
	name: "Lifecycle Demo Sandbox",
	os: "ubuntu:24.04",
});
log(`Sandbox created: ${sandbox.id}`);
log(`Status: ${sandbox.status}, Setup: ${sandbox.setupStatus}\n`);

// Run a command while running
log("Running command: uptime");
await sandbox.runCommand({
	command: "uptime",
});

// Stop the sandbox
log("\nStopping sandbox...");
await sandbox.stop();
log(`Sandbox stopped. Status: ${sandbox.status}\n`);

// Start the sandbox again
log("Starting sandbox...");
await sandbox.start();
log(`Sandbox started. Status: ${sandbox.status}\n`);

// Run another command
log("Running command: df -h");
await sandbox.runCommand({
	command: "df -h",
});

// Restart the sandbox
log("\nRestarting sandbox...");
await sandbox.restart();
log(`Sandbox restarted. Status: ${sandbox.status}\n`);

// Final command
log("Running final command: hostname");
await sandbox.runCommand({
	command: "hostname",
});

// Cleanup
log("\nCleaning up...");
await sandbox.destroy();
log("Sandbox deleted successfully");
