import { Controller, Get, Header } from '@nestjs/common';

import { HealthService, type Status } from './health.service.js';

@Controller('health')
export class HealthController {
  // Constructor injection without @Inject: resolved through the design:paramtypes metadata SWC emits.
  constructor(private readonly health: HealthService) {}

  /** Liveness. */
  @Get()
  @Header('Cache-Control', 'no-store')
  live(): Status {
    return this.health.live();
  }
}
