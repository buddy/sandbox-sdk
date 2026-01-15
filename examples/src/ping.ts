import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Ping Sandbox Example\n");

const identifier = "ping-dev-sandbox";
log(`Getting sandbox with identifier: ${identifier}`);

let sandbox: Sandbox;

const list = await Sandbox.list({ simple: true });
const id = list.find((s) => s.identifier === identifier)?.id;

if (id) {
	sandbox = await Sandbox.getById(id);
	log(
		`Found existing sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`,
	);
} else {
	log("Creating new sandbox...");
	sandbox = await Sandbox.create({
		identifier,
		name: "My Ping Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
}

log("\n=== Mode 1: Real-time streaming ===");
log("Output appears as the command runs:\n");

await sandbox.runCommand({
	command: "ping -c 4 buddy.works",
	runtime: "BASH",
});

log("\n=== Mode 2: Parallel execution ===");
log("Run multiple commands simultaneously, results print as they complete.");

const [cmd1, cmd2] = await Promise.all([
	sandbox.runCommand({
		command:
			"echo 'Starting slow task...' && sleep 3 && echo 'Slow task done!'",
		runtime: "BASH",
		detached: true,
		stdout: null,
		stderr: null,
	}),
	sandbox.runCommand({
		command:
			"echo 'Starting fast task...' && sleep 1 && echo 'Fast task done!'",
		runtime: "BASH",
		detached: true,
		stdout: null,
		stderr: null,
	}),
]);

log("Both commands started in background! Waiting for results...\n");

await Promise.all([
	cmd1.wait().then(async (finished) => {
		log(`[Slow] Exit code: ${finished.exitCode}`);
		log(`[Slow] Output:\n${await finished.output()}`);
	}),
	cmd2.wait().then(async (finished) => {
		log(`[Fast] Exit code: ${finished.exitCode}`);
		log(`[Fast] Output:\n${await finished.output()}`);
	}),
]);

log("\n=== Mode 3: Fire and forget ===");
log("Commands run on the server independently - you can check back anytime.");
log("Launching a 2-second task, then doing other work for 5 seconds...\n");

const cmd3 = await sandbox.runCommand({
	command: "echo 'Quick task' && sleep 2 && echo 'Done!'",
	runtime: "BASH",
	detached: true,
	stdout: null,
	stderr: null,
});

log("Command running on server. Doing other work locally...");
await new Promise((resolve) => setTimeout(resolve, 5000));

log("Done with local work. Checking if server command finished...");
const start = Date.now();
const finished3 = await cmd3.wait();
log(
	`Status check took ${Date.now() - start}ms (instant - command already done!)`,
);
log(`Output:\n${await finished3.output()}`);

log("Ping example completed!");
