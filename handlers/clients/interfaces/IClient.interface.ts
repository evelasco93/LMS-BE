import { ClientStatus } from "../enums/client-status.enum";
import { RequestActor } from "@shared/utils/request-audit.util";

export interface IClient {
  id: string;
  name: string;
  email: string;
  phone?: string;
  client_code?: string;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  deleted_by?: RequestActor;
  deleted_at?: string;
  is_deleted?: boolean;
  active?: boolean;
}
