import { describe, expect, it } from "vitest";
import { zAddSandboxBody, zShortEnvironmentView } from "@/api/openapi/zod.gen";

/**
 * Guards the generated-schema workaround in `scripts/cleanup-schemas.ts`. Both
 * failure modes are silent: an unpatched schema either rejects a good response
 * or strips the scope from a create request, turning an environment sandbox
 * into a project one.
 */
describe("generated schema patches", () => {
	it("accepts environment IDs as the hashid strings the API really returns", () => {
		const result = zShortEnvironmentView.safeParse({
			id: "nZrnl40Y",
			identifier: "staging",
		});

		expect(result.success).toBe(true);
		expect(result.data?.id).toBe("nZrnl40Y");
	});

	it("keeps scope and environment in the create-sandbox body", () => {
		const result = zAddSandboxBody.safeParse({
			name: "New sandbox",
			os: "ubuntu:24.04",
			scope: "ENVIRONMENT",
			environment: { id: "nZrnl40Y" },
		});

		expect(result.success).toBe(true);
		// The client sends the parse result, not the input, so anything zod
		// strips here never reaches the API.
		expect(result.data).toMatchObject({
			scope: "ENVIRONMENT",
			environment: { id: "nZrnl40Y" },
		});
	});
});
