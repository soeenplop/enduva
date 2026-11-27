import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type * as z from 'zod';

export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ code: 'validation_failed', issues: result.error.issues });
    }
    return result.data;
  }
}
