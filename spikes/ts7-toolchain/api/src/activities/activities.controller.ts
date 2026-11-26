import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { type Activity, ActivityParams, ActivityQuery } from '@spike/contracts';
import { BearerGuard } from '../auth/bearer.guard.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { ActivitiesService } from './activities.service.js';

@Controller('v1/activities')
@UseGuards(BearerGuard)
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get(':activityId')
  get(
    @Param(new ZodValidationPipe(ActivityParams)) params: ActivityParams,
    @Query(new ZodValidationPipe(ActivityQuery)) query: ActivityQuery,
  ): Activity {
    return this.activities.get(params.activityId, query.units);
  }
}
