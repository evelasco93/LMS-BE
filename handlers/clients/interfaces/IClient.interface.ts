import { ClientStatus } from '../enums/client-status.enum';

export interface IClient {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  status: ClientStatus;
  api_key: string;
  created_at: string;
  updated_at: string;
}
