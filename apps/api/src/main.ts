import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp, DOCS_PATH } from './app.setup';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get('PORT');
  await app.listen(port);
  Logger.log(
    `API listening on http://localhost:${port}/${API_PREFIX} (docs: ${DOCS_PATH})`,
    'Bootstrap',
  );
}

void bootstrap();
