import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("List Sandboxes Example\n");

log("Fetching all sandboxes in the workspace...\n");

const sandboxes = await Sandbox.list();

if (sandboxes.length === 0) {
	log("No sandboxes found in the workspace.");
} else {
	log(`Found ${sandboxes.length} sandbox(es):\n`);

	for (const sandbox of sandboxes) {
		log(`  - ${sandbox.name}`);
		log(`    ID: ${sandbox.id}`);
		log(`    Identifier: ${sandbox.identifier}`);
		log(`    Status: ${sandbox.status}`);
		log(`    URL: ${sandbox.html_url}\n`);
	}
}

log("List example completed!");
