import { injectable } from "inversify";

@injectable()
export class ClientConstants {
  public readonly CLIENTS_TABLE_NAME: string;

  constructor() {
    this.CLIENTS_TABLE_NAME = process.env.CLIENTS_TABLE_NAME ?? "";

    if (!this.CLIENTS_TABLE_NAME) {
      throw new Error("CLIENTS_TABLE_NAME env var is required");
    }
  }
}
