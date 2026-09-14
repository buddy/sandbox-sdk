// The suite pins its own scope, and the scope suites use BUDDY_TEST_*. Left
// set, BUDDY_ENVIRONMENT would move every other test into that environment.
delete process.env["BUDDY_ENVIRONMENT"];
