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
import type { WithRequired } from "@/types/utils";
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

export const GetSandboxResponseSchema = getSandboxResponse
	.required({
		id: true,
		identifier: true,
		name: true,
		status: true,
	})
	.optional();

export type IGetSandboxResponse =
	| WithRequired<
			IOpenApiGetSandboxResponse,
			"id" | "identifier" | "name" | "status"
	  >
	| undefined;

export const __AssertGetSandboxResponse: AssertTypesMatch<
	IGetSandboxResponse,
	z.infer<typeof GetSandboxResponseSchema>
> = true;

//

export const CreateSandboxRequestSchema = addSandboxBody.options[2];

export type ICreateSandboxRequest = Exclude<
	IOpenApiAddSandboxBody,
	{ source_sandbox_id: string } | { snapshot_id: string }
>;

export const __AssertCreateSandboxRequest: AssertTypesMatch<
	ICreateSandboxRequest,
	z.infer<typeof CreateSandboxRequestSchema>
> = true;

//

export const CreateSandboxResponseSchema = GetSandboxResponseSchema.unwrap();

export type ICreateSandboxResponse = ISandbox;

export const __AssertCreateSandboxResponse: AssertTypesMatch<
	ICreateSandboxResponse,
	z.infer<typeof CreateSandboxResponseSchema>
> = true;

//

export const GetSandboxesResponseSchema = getSandboxesResponse;

export type IGetSandboxesResponse = IOpenApiGetSandboxesResponse & {
	sandboxes?: ISimplifiedSandbox[] | undefined;
};

export const __AssertGetSandboxesResponse: AssertTypesMatch<
	IGetSandboxesResponse,
	z.infer<typeof GetSandboxesResponseSchema>
> = true;

//

export const ExecuteSandboxCommandRequestSchema = executeSandboxCommandBody;

export type IExecuteSandboxCommandRequest = IOpenApiExecuteSandboxCommandBody;

export const __AssertExecuteSandboxCommandRequest: AssertTypesMatch<
	IExecuteSandboxCommandRequest,
	z.infer<typeof ExecuteSandboxCommandRequestSchema>
> = true;

//

export const ExecuteSandboxCommandResponseSchema =
	executeSandboxCommandResponse;

export type IExecuteSandboxCommandResponse =
	IOpenApiExecuteSandboxCommandResponse;

export const __AssertExecuteSandboxCommandResponse: AssertTypesMatch<
	IExecuteSandboxCommandResponse,
	z.infer<typeof ExecuteSandboxCommandResponseSchema>
> = true;

//

export const GetSandboxCommandResponseSchema = getSandboxCommandResponse;

export type IGetSandboxCommandResponse = IOpenApiGetSandboxCommandResponse;

export const __AssertGetSandboxCommandResponse: AssertTypesMatch<
	IGetSandboxCommandResponse,
	z.infer<typeof GetSandboxCommandResponseSchema>
> = true;

//

export const TerminateSandboxCommandResponseSchema =
	terminateSandboxCommandResponse;

export type ITerminateSandboxCommandResponse =
	IOpenApiTerminateSandboxCommandResponse;

export const __AssertTerminateSandboxCommandResponse: AssertTypesMatch<
	ITerminateSandboxCommandResponse,
	z.infer<typeof TerminateSandboxCommandResponseSchema>
> = true;

//

export const StartSandboxResponseSchema = startSandboxResponse;

export type IStartSandboxResponse = IOpenApiStartSandboxResponse;

export const __AssertStartSandboxResponse: AssertTypesMatch<
	IStartSandboxResponse,
	z.infer<typeof StartSandboxResponseSchema>
> = true;

//

export const StopSandboxResponseSchema = stopSandboxResponse;

export type IStopSandboxResponse = IOpenApiStopSandboxResponse;

export const __AssertStopSandboxResponse: AssertTypesMatch<
	IStopSandboxResponse,
	z.infer<typeof StopSandboxResponseSchema>
> = true;

//

export const RestartSandboxResponseSchema = restartSandboxResponse;

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
