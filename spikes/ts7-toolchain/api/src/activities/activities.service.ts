import { Injectable, NotFoundException } from '@nestjs/common';
import type { Activity, ActivityQuery } from '@spike/contracts';

const KM_PER_MILE = 1.609344;

@Injectable()
export class ActivitiesService {
  private readonly activities = new Map<string, Omit<Activity, 'distance' | 'distanceUnit'> & { km: number }>([
    [
      '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a',
      { id: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a', sport: 'run', km: 10, startedAt: '2026-11-26T08:00:00Z' },
    ],
  ]);

  get(id: string, units: ActivityQuery['units']): Activity {
    const found = this.activities.get(id);
    if (!found) throw new NotFoundException({ code: 'activity_not_found' });
    const { km, ...rest } = found;
    return units === 'imperial'
      ? { ...rest, distance: Math.round((km / KM_PER_MILE) * 100) / 100, distanceUnit: 'mi' }
      : { ...rest, distance: km, distanceUnit: 'km' };
  }
}
