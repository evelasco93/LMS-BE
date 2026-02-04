import 'reflect-metadata';
import { injectable } from 'inversify';
import { LeadService } from '../services/leadService';
import { LeadController } from '../controllers/leadController';

@injectable()
export class LeadModule {
  private static instance: any;

  static async getInstance() {
    if (!LeadModule.instance) {
      const { Container } = await import('inversify');
      const container = new Container();

      // Bind services
      container.bind<LeadService>('LeadService').to(LeadService).inSingletonScope();

      // Bind controllers
      container.bind<LeadController>(LeadController).toSelf().inSingletonScope();

      LeadModule.instance = container;
    }

    return LeadModule.instance;
  }
}
