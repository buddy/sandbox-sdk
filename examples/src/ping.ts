import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Ping Sandbox Example\n");

const identifier = "ping-dev-sandbox";
log(`Getting sandbox with identifier: ${identifier}`);

let sandbox: Sandbox;
try {
	sandbox = await Sandbox.get(identifier);
	log(`Found existing sandbox: ${sandbox.id}`);
} catch {
	log("Creating new sandbox...");
	sandbox = await Sandbox.create({
		identifier,
		name: "My Ping Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.id}`);
}

log("Starting ping");

await sandbox.runCommand({
	command: "ping -c 5 buddy.works",
});
