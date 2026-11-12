import { Injectable, Logger } from '@nestjs/common';
import { type HealthResponse } from '@garfo/shared';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthResponse> {
    const llm = this.config.get('LLM_PROVIDER');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok', llm };
    } catch (error) {
      this.logger.error(
        `Database ping failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { status: 'error', db: 'error', llm };
    }
  }
}
