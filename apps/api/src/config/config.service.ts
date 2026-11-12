import { Injectable } from '@nestjs/common';
import { type Env } from './env';

/** Typed, read-only access to the validated environment. */
@Injectable()
export class ConfigService {
  constructor(private readonly env: Readonly<Env>) {}

  /** The whole validated environment (used by provider factories). */
  all(): Readonly<Env> {
    return this.env;
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }
}
