import { injectable } from 'inversify';
import { constant } from '@shared/decorators/constant.decorator';

@injectable()
export class AffiliateConstants {
  @constant
  public readonly AFFILIATES_TABLE_NAME = process.env.AFFILIATES_TABLE_NAME!;
}
