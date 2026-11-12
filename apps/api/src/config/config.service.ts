import { Injectable } from '@nestjs/common';
import { type Env } from './env';

/** Typed, read-only access to the validated environment. */
@Injectable()
export class ConfigService {
  constructor(private readonly env: Readonly<Env>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }
}
