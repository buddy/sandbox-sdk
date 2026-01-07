import { z } from "zod";
import {
	addSandboxBody,
	executeSandboxCommandBody,
	executeSandboxCommandResponse,
	getSandboxesResponse,
	getSandboxResponse,
} from "./sandbox-rest-api.gen";

export const AddSandboxRequestSchema = z.object({
	...addSandboxBody.options[2]?.shape,
});

export const GetSandboxResponseSchema = z.object({
	...getSandboxResponse.shape,
	id: z.string().describe("The ID of the sandbox"),
});

export const GetSandboxesResponseSchema = z.object({
	...getSandboxesResponse.shape,
});

export const ExecuteSandboxCommandRequestSchema = z.object({
	...executeSandboxCommandBody.shape,
});

export const ExecuteSandboxCommandResponseSchema = z.object({
	...executeSandboxCommandResponse.shape,
});

export const SandboxCommandLogSchema = z.object({
	type: z.enum(["STDOUT", "STDERR"]),
	data: z.string(),
});
