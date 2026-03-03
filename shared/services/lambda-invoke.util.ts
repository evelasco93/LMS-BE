import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

export interface InvokeLambdaJsonParams {
  functionName: string;
  payload?: Record<string, unknown>;
}

export class LambdaInvokeUtil {
  private readonly lambdaClient: LambdaClient;

  constructor(lambdaClient?: LambdaClient) {
    this.lambdaClient = lambdaClient ?? new LambdaClient({});
  }

  async invokeJson<TResponse = unknown>({
    functionName,
    payload,
  }: InvokeLambdaJsonParams): Promise<TResponse> {
    const invokeResult = await this.lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(payload ?? {})),
      }),
    );

    if (invokeResult.FunctionError) {
      throw new Error(
        `Lambda invocation failed: ${invokeResult.FunctionError}`,
      );
    }

    if (!invokeResult.Payload) {
      return {} as TResponse;
    }

    const decodedPayload = new TextDecoder("utf-8").decode(
      invokeResult.Payload,
    );
    if (!decodedPayload) {
      return {} as TResponse;
    }

    return JSON.parse(decodedPayload) as TResponse;
  }
}
