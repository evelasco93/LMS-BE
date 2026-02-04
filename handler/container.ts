import { Container } from 'inversify';
import { LeadService } from './services/leadService';
import { LeadController } from './controllers/leadController';

const container = new Container();

// Bind services
container.bind<LeadService>('LeadService').to(LeadService).inSingletonScope();

// Bind controllers
container.bind<LeadController>('LeadController').to(LeadController).inSingletonScope();

export { container };
