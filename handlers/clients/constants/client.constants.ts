import { injectable } from 'inversify';
import { constant } from '@shared/decorators/constant.decorator';

@injectable()
export class ClientConstants {
  @constant
  public readonly CLIENTS_TABLE_NAME = process.env.CLIENTS_TABLE_NAME!;
}
