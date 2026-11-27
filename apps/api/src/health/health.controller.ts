import { Controller, Get, Header } from '@nestjs/common';
import type { HealthStatus } from '@enduva/contracts';

import { Public } from '../auth/auth.guard.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  // Constructor injection without @Inject: resolved through the design:paramtypes metadata SWC emits.
  constructor(private readonly health: HealthService) {}

  /** Liveness. Public, like readiness; new handlers here need a token unless marked too. */
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  live(): HealthStatus {
    return this.health.live();
  }

  /** Readiness: the database is reachable. 503 problem `database_unavailable` otherwise. */
  @Public()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  ready(): Promise<HealthStatus> {
    return this.health.ready();
  }
}
