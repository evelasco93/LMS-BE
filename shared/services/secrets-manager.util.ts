import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  RestoreSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export interface SecretUpsertParams {
  secretName: string;
  value: string;
}

export interface DeleteSecretParams {
  secretName: string;
  forceDeleteWithoutRecovery?: boolean;
  recoveryWindowInDays?: number;
}

export class SecretsManagerUtil {
  private readonly client: SecretsManagerClient;

  constructor(client?: SecretsManagerClient) {
    this.client = client ?? new SecretsManagerClient({});
  }

  async upsertSecret({ secretName, value }: SecretUpsertParams): Promise<void> {
    try {
      await this.client.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: value,
        }),
      );
      return;
    } catch (error: any) {
      const isAlreadyExists =
        error?.name === "ResourceExistsException" ||
        error?.Code === "ResourceExistsException";

      if (!isAlreadyExists) {
        throw error;
      }
    }

    await this.client.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: value,
      }),
    );
  }

  async upsertJsonSecret<T extends object>(
    secretName: string,
    value: T,
  ): Promise<void> {
    await this.upsertSecret({
      secretName,
      value: JSON.stringify(value),
    });
  }

  async getSecret(secretName: string): Promise<string | null> {
    const result = await this.client.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      }),
    );

    return result.SecretString ?? null;
  }

  async getJsonSecret<T = Record<string, unknown>>(
    secretName: string,
  ): Promise<T | null> {
    const raw = await this.getSecret(secretName);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  }

  async deleteSecret({
    secretName,
    forceDeleteWithoutRecovery = false,
    recoveryWindowInDays,
  }: DeleteSecretParams): Promise<void> {
    await this.client.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        ForceDeleteWithoutRecovery: forceDeleteWithoutRecovery,
        RecoveryWindowInDays: forceDeleteWithoutRecovery
          ? undefined
          : recoveryWindowInDays,
      }),
    );
  }

  async restoreSecret(secretName: string): Promise<void> {
    await this.client.send(
      new RestoreSecretCommand({
        SecretId: secretName,
      }),
    );
  }
}
