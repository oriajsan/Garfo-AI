import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { validateEnv } from './env';

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useFactory: () => new ConfigService(Object.freeze(validateEnv(process.env))),
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
