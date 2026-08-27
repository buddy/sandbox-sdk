/**
 * Keeps the suite in project scope: BUDDY_ENVIRONMENT would otherwise move
 * every test into that environment. Moved aside, not dropped - the scope tests
 * use it explicitly.
 */
const environment = process.env["BUDDY_ENVIRONMENT"];

if (environment) {
	process.env["BUDDY_TEST_ENVIRONMENT"] = environment;
	delete process.env["BUDDY_ENVIRONMENT"];
}
