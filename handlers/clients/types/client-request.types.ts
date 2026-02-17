import { ClientStatus } from "../enums/client-status.enum";

export type CreateClientRequest = {
  name: string;
  email: string;
  phone?: string;
  client_code?: string;
};

export type UpdateClientRequest = Partial<
  Omit<CreateClientRequest, "email">
> & {
  email?: string;
  status?: ClientStatus;
};

export type ListClientsQuery = {
  status?: ClientStatus;
  limit?: number;
  lastEvaluatedKey?: string;
};
