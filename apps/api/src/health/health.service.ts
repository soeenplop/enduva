import { Injectable } from '@nestjs/common';

export interface Status {
  readonly status: 'ok';
}

@Injectable()
export class HealthService {
  /** Liveness: the process serves requests. Touches nothing else, so a database outage won't restart it. */
  live(): Status {
    return { status: 'ok' };
  }
}
