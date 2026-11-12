import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ConfigService } from './config/config.service';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = '/docs';
const JSON_BODY_LIMIT = '10kb';

/** HTTP hardening and docs, shared by `main.ts` and the e2e tests. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  // Behind Railway's proxy: the real client IP comes from X-Forwarded-For (rate limit per IP).
  app.set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX);
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.enableCors({ origin: config.get('CORS_ORIGIN') });

  // The Scalar page loads its script and styles from a CDN, so the strict default CSP of
  // helmet is relaxed for /docs only; every other route keeps the full policy.
  const strict = helmet();
  const relaxed = helmet({ contentSecurityPolicy: false });
  app.use((req: { path: string }, res: object, next: () => void) =>
    (req.path.startsWith(DOCS_PATH) ? relaxed : strict)(req as never, res as never, next),
  );

  mountDocs(app);
}

function mountDocs(app: INestApplication): void {
  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Garfo API')
        .setDescription('Assistente de pedidos com IA: catálogo, busca híbrida e carrinho.')
        .setVersion('0.1.0')
        .build(),
    ),
  );
  app.use(DOCS_PATH, apiReference({ spec: { content: document }, theme: 'default' }));
}
