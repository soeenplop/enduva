import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities/activities.controller.js';
import { ActivitiesService } from './activities/activities.service.js';
import { BearerGuard } from './auth/bearer.guard.js';
import { TokenVerifier } from './auth/token-verifier.service.js';

@Module({
  controllers: [ActivitiesController],
  providers: [ActivitiesService, TokenVerifier, BearerGuard],
})
export class AppModule {}
