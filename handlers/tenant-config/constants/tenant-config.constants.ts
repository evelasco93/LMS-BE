import { injectable } from "inversify";

@injectable()
export class TenantConfigConstants {
  public readonly IPQS_SECRET_NAME: string;
  public readonly TRUSTED_FORMS_SECRET_NAME: string;
  public readonly SECRET_PREFIX: string;
  public readonly INTERNAL_API_AUTH_TOKEN_SECRET_NAME: string;
  public readonly EXTERNAL_LEADS_API_KEY_SECRET_NAME: string;

  constructor() {
    this.IPQS_SECRET_NAME = process.env.TENANT_CONFIG_IPQS_SECRET_NAME ?? "";
    this.TRUSTED_FORMS_SECRET_NAME =
      process.env.TENANT_CONFIG_TRUSTED_FORMS_SECRET_NAME ?? "";
    this.SECRET_PREFIX = process.env.TENANT_CONFIG_SECRET_PREFIX ?? "";
    this.INTERNAL_API_AUTH_TOKEN_SECRET_NAME =
      process.env.INTERNAL_API_AUTH_TOKEN_SECRET_NAME ?? "";
    this.EXTERNAL_LEADS_API_KEY_SECRET_NAME =
      process.env.EXTERNAL_LEADS_API_KEY_SECRET_NAME ?? "";
  }
}
