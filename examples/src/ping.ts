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

log("Starting ping");

await sandbox.runCommand({
	command: "echo 'Pinging...'; ping -c 4 buddy.works",
	runtime: "BASH",
});
