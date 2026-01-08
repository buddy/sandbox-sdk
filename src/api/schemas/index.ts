import { z } from "zod";
import type {
	IOpenApiAddSandboxBody,
	IOpenApiExecuteSandboxCommandBody,
	IOpenApiExecuteSandboxCommandResponse,
	IOpenApiGetSandboxesResponse,
	IOpenApiGetSandboxResponse,
} from "@/api/schemas/types.gen";
import {
	addSandboxBody,
	executeSandboxCommandBody,
	executeSandboxCommandResponse,
	getSandboxesResponse,
	getSandboxResponse,
} from "./sandbox-rest-api.gen";

type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export const AddSandboxRequestSchema = z.object({
	...addSandboxBody.options[2]?.shape,
});

export type IAddSandboxRequest = Prettify<
	Exclude<
		IOpenApiAddSandboxBody,
		{ source_sandbox_id: string } | { snapshot_id: string }
	> & {}
>;

export const GetSandboxResponseSchema = z.object({
	...getSandboxResponse.shape,
	id: z.string().describe("The ID of the sandbox"),
});

export type IGetSandboxResponse = Prettify<
	IOpenApiGetSandboxResponse & {
		/** The ID of the sandbox */
		id: string;
	}
>;

export const GetSandboxesResponseSchema = z.object({
	...getSandboxesResponse.shape,
});

export type IGetSandboxesResponse = Prettify<IOpenApiGetSandboxesResponse & {}>;

export const ExecuteSandboxCommandRequestSchema = z.object({
	...executeSandboxCommandBody.shape,
});

export type IExecuteSandboxCommandRequest = Prettify<
	IOpenApiExecuteSandboxCommandBody & {}
>;

export const ExecuteSandboxCommandResponseSchema = z.object({
	...executeSandboxCommandResponse.shape,
});

export type IExecuteSandboxCommandResponse = Prettify<
	IOpenApiExecuteSandboxCommandResponse & {}
>;

export const SandboxCommandLogSchema = z.object({
	type: z
		.enum(["STDOUT", "STDERR"])
		.describe(
			"The type of command output stream. `STDOUT` for standard output, `STDERR` for error output.",
		),
	data: z.string().describe("The command execution logs."),
});

export type ISandboxCommandLog = {
	/** The type of command output stream. `STDOUT` for standard output, `STDERR` for error output. */
	type: "STDOUT" | "STDERR";
	/** The command execution logs. */
	data: string;
};
