import * as z from 'zod';

/** Body of the health endpoints (`GET /v1/health`, `GET /v1/health/ready`). */
export const HealthStatus = z.object({ status: z.literal('ok') }).meta({ id: 'HealthStatus' });

export type HealthStatus = z.output<typeof HealthStatus>;
