import { z } from "zod";
import type {
	IOpenApiAddSandboxBody,
	IOpenApiExecuteSandboxCommandBody,
	IOpenApiExecuteSandboxCommandResponse,
	IOpenApiGetSandboxCommandResponse,
	IOpenApiGetSandboxesResponse,
	IOpenApiGetSandboxResponse,
	IOpenApiRestartSandboxResponse,
	IOpenApiStartSandboxResponse,
	IOpenApiStopSandboxResponse,
	IOpenApiTerminateSandboxCommandResponse,
} from "@/api/schemas/types.gen";
import {
	addSandboxBody,
	executeSandboxCommandBody,
	executeSandboxCommandResponse,
	getSandboxCommandResponse,
	getSandboxesResponse,
	getSandboxResponse,
	restartSandboxResponse,
	startSandboxResponse,
	stopSandboxResponse,
	terminateSandboxCommandResponse,
} from "./sandbox-rest-api.gen";

type AssertTypesMatch<T, U> = [T] extends [U]
	? [U] extends [T]
		? true
		: { error: true; extra: Exclude<T, U> }
	: { error: true; missing: Exclude<U, T> };

export type ISandbox = NonNullable<IGetSandboxResponse>;
export type ISimplifiedSandbox = NonNullable<
	IOpenApiGetSandboxesResponse["sandboxes"]
>[number];

//
// Sandbox REST API Schemas and Types
// They are modified versions of the original OpenAPI-generated schemas/types
// The exported assert types are used to ensure that the modified types match the schemas
//

export const GetSandboxResponseSchema = z
	.object({
		...getSandboxResponse.shape,
		id: z.string().describe("The ID of the sandbox"),
	})
	.optional();

export type IGetSandboxResponse =
	| (IOpenApiGetSandboxResponse & {
			/** The ID of the sandbox */
			id: string;
	  })
	| undefined;

export const __AssertGetSandboxResponse: AssertTypesMatch<
	IGetSandboxResponse,
	z.infer<typeof GetSandboxResponseSchema>
> = true;

//

export const CreateSandboxRequestSchema = z.object({
	...addSandboxBody.options[2]?.shape,
});

export type ICreateSandboxRequest = Exclude<
	IOpenApiAddSandboxBody,
	{ source_sandbox_id: string } | { snapshot_id: string }
>;

export const __AssertCreateSandboxRequest: AssertTypesMatch<
	ICreateSandboxRequest,
	z.infer<typeof CreateSandboxRequestSchema>
> = true;

//

export const CreateSandboxResponseSchema = z.object({
	...GetSandboxResponseSchema.unwrap().shape,
});

export type ICreateSandboxResponse = ISandbox;

export const __AssertCreateSandboxResponse: AssertTypesMatch<
	ICreateSandboxResponse,
	z.infer<typeof CreateSandboxResponseSchema>
> = true;

//

export const GetSandboxesResponseSchema = z.object({
	...getSandboxesResponse.shape,
});

export type IGetSandboxesResponse = IOpenApiGetSandboxesResponse & {
	sandboxes?: ISimplifiedSandbox[] | undefined;
};

export const __AssertGetSandboxesResponse: AssertTypesMatch<
	IGetSandboxesResponse,
	z.infer<typeof GetSandboxesResponseSchema>
> = true;

//

export const ExecuteSandboxCommandRequestSchema = z.object({
	...executeSandboxCommandBody.shape,
});

export type IExecuteSandboxCommandRequest = IOpenApiExecuteSandboxCommandBody;

export const __AssertExecuteSandboxCommandRequest: AssertTypesMatch<
	IExecuteSandboxCommandRequest,
	z.infer<typeof ExecuteSandboxCommandRequestSchema>
> = true;

//

export const ExecuteSandboxCommandResponseSchema = z.object({
	...executeSandboxCommandResponse.shape,
});

export type IExecuteSandboxCommandResponse =
	IOpenApiExecuteSandboxCommandResponse;

export const __AssertExecuteSandboxCommandResponse: AssertTypesMatch<
	IExecuteSandboxCommandResponse,
	z.infer<typeof ExecuteSandboxCommandResponseSchema>
> = true;

//

export const GetSandboxCommandResponseSchema = z.object({
	...getSandboxCommandResponse.shape,
});

export type IGetSandboxCommandResponse = IOpenApiGetSandboxCommandResponse;

export const __AssertGetSandboxCommandResponse: AssertTypesMatch<
	IGetSandboxCommandResponse,
	z.infer<typeof GetSandboxCommandResponseSchema>
> = true;

//

export const TerminateSandboxCommandResponseSchema = z.object({
	...terminateSandboxCommandResponse.shape,
});

export type ITerminateSandboxCommandResponse =
	IOpenApiTerminateSandboxCommandResponse;

export const __AssertTerminateSandboxCommandResponse: AssertTypesMatch<
	ITerminateSandboxCommandResponse,
	z.infer<typeof TerminateSandboxCommandResponseSchema>
> = true;

//

export const StartSandboxResponseSchema = z.object({
	...startSandboxResponse.shape,
});

export type IStartSandboxResponse = IOpenApiStartSandboxResponse;

export const __AssertStartSandboxResponse: AssertTypesMatch<
	IStartSandboxResponse,
	z.infer<typeof StartSandboxResponseSchema>
> = true;

//

export const StopSandboxResponseSchema = z.object({
	...stopSandboxResponse.shape,
});

export type IStopSandboxResponse = IOpenApiStopSandboxResponse;

export const __AssertStopSandboxResponse: AssertTypesMatch<
	IStopSandboxResponse,
	z.infer<typeof StopSandboxResponseSchema>
> = true;

//

export const RestartSandboxResponseSchema = z.object({
	...restartSandboxResponse.shape,
});

export type IRestartSandboxResponse = IOpenApiRestartSandboxResponse;

export const __AssertRestartSandboxResponse: AssertTypesMatch<
	IRestartSandboxResponse,
	z.infer<typeof RestartSandboxResponseSchema>
> = true;

//

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

export const __AssertSandboxCommandLog: AssertTypesMatch<
	ISandboxCommandLog,
	z.infer<typeof SandboxCommandLogSchema>
> = true;
