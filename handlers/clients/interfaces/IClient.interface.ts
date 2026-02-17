import { ClientStatus } from "../enums/client-status.enum";

export interface IClient {
  id: string;
  name: string;
  email: string;
  phone?: string;
  client_code?: string;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
}
