import { IClient } from "../../interfaces/IClient.interface";
import { ClientStatus } from "../../enums/client-status.enum";

export const mockClient: IClient = {
  id: "CLABCDEFGHIJ",
  name: "Test Client",
  email: "test@example.com",
  status: ClientStatus.ACTIVE,
  api_key: "test-api-key-123",
  created_at: "2026-02-16T00:00:00.000Z",
  updated_at: "2026-02-16T00:00:00.000Z",
};

export const mockExistingClient: IClient = {
  id: "CLEXISTING01",
  name: "Existing Client",
  email: "existing@example.com",
  company: "Existing Company",
  status: ClientStatus.ACTIVE,
  api_key: "existing-api-key-456",
  created_at: "2026-02-15T00:00:00.000Z",
  updated_at: "2026-02-15T00:00:00.000Z",
};
