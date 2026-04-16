import { ClientStatus } from "../enums/client-status.enum";

export type CreateClientRequest = {
  name: string;
  notes?: string;
  client_code?: string;
};

export type UpdateClientRequest = Partial<CreateClientRequest> & {
  status?: ClientStatus;
};

export type ListClientsQuery = {
  status?: ClientStatus;
  limit?: number;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
  includeCampaigns?: boolean;
};
