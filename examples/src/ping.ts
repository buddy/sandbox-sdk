import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

async function main() {
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
			sandbox: {
				identifier,
				name: "My Ping Sandbox",
				os: "ubuntu:24.04",
			},
		});
		log(`Created sandbox: ${sandbox.id}`);
	}

	log("Starting ping");
	await sandbox.runCommand({
		command: "ping -c 5 8.8.8.8",
	});
}

main().catch(console.error);
