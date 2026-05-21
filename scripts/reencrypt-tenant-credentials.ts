import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { decrypt, encrypt } from "../shared/utils/crypto.util";

type CredentialType = "api_key" | "basic_auth" | "bearer_token";

type TenantCredentialRecord = {
  id: string;
  type: "credential";
  credential_type: CredentialType;
  credentials: Record<string, string>;
  updated_at?: string;
  [key: string]: unknown;
};

const SENSITIVE_FIELDS: Record<CredentialType, string[]> = {
  api_key: ["apiKey"],
  basic_auth: ["password"],
  bearer_token: ["token"],
};

function isValidHexKey(key: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(key);
}

function isEncrypted(value: string, key: string): boolean {
  try {
    decrypt(value, key);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const tableName = process.env.TENANT_SETTINGS_TABLE_NAME;
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const dryRun = process.argv.includes("--dry-run");

  if (!tableName) {
    throw new Error("TENANT_SETTINGS_TABLE_NAME is required");
  }
  if (!key || !isValidHexKey(key)) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string",
    );
  }

  const client = new DynamoDBClient({});
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  const scanResult = await doc.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "#t = :credentialType",
      ExpressionAttributeNames: { "#t": "type" },
      ExpressionAttributeValues: { ":credentialType": "credential" },
    }),
  );

  const items = (scanResult.Items ?? []) as TenantCredentialRecord[];

  let inspected = 0;
  let updated = 0;
  let alreadyEncrypted = 0;

  for (const item of items) {
    inspected += 1;
    const sensitiveFields = SENSITIVE_FIELDS[item.credential_type] ?? [];
    const credentials = { ...(item.credentials ?? {}) };

    let changed = false;

    for (const field of sensitiveFields) {
      const value = credentials[field];
      if (!value) continue;

      if (!isEncrypted(value, key)) {
        credentials[field] = encrypt(String(value), key);
        changed = true;
      }
    }

    if (!changed) {
      alreadyEncrypted += 1;
      continue;
    }

    if (!dryRun) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            ...item,
            credentials,
            updated_at: new Date().toISOString(),
          },
        }),
      );
    }

    updated += 1;
  }

  console.log(`Inspected: ${inspected}`);
  console.log(`Updated: ${updated}${dryRun ? " (dry-run)" : ""}`);
  console.log(`Already encrypted: ${alreadyEncrypted}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
