import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private lastError: string | null = null;
  private wasConnected = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) {
      this.lastError = 'DATABASE_URL is not set';
      this.logger.warn(this.lastError);
      return;
    }

    this.pool = new Pool({
      connectionString,
      max: 20,
      connectionTimeoutMillis: 3000,
    });

    this.pool.on('error', (err) => {
      this.lastError = err.message;
      this.wasConnected = false;
      this.logger.error(`PostgreSQL pool error: ${err.message}`);
    });

    await this.ping();
  }

  async onModuleDestroy() {
    await this.pool?.end();
    this.pool = null;
  }

  async ping(): Promise<boolean> {
    if (!this.pool) {
      this.lastError = this.lastError ?? 'Database pool not initialized';
      return false;
    }
    try {
      const { rows } = await this.pool.query<{ now: Date }>('SELECT now() AS now');
      this.lastError = null;
      if (!this.wasConnected) {
        this.logger.log(`PostgreSQL connected at ${rows[0].now.toISOString()}`);
        this.wasConnected = true;
      }
      return true;
    } catch (err) {
      this.lastError = this.formatError(err);
      if (this.wasConnected) {
        this.logger.warn(`PostgreSQL connection lost: ${this.lastError}`);
      } else {
        this.logger.warn(
          `PostgreSQL unavailable (${this.lastError}). Start Docker PostGIS on port 5433: npm run db:up && npm run db:migrate`,
        );
      }
      this.wasConnected = false;
      return false;
    }
  }

  getStatus() {
    return {
      connected: this.lastError === null && this.pool !== null,
      error: this.lastError,
    };
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        this.lastError ?? 'Database is not configured',
      );
    }
    return this.pool.query<T>(text, params).catch((err: Error) => {
      this.lastError = err.message;
      throw err;
    });
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        this.lastError ?? 'Database is not configured',
      );
    }
    return this.pool;
  }

  private formatError(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const parts = [err.message].filter(Boolean);
    const nested = err as Error & {
      code?: string;
      errors?: Error[];
      cause?: unknown;
    };
    if (nested.code) parts.push(`code=${nested.code}`);
    if (Array.isArray(nested.errors)) {
      for (const inner of nested.errors) {
        if (inner?.message) parts.push(inner.message);
      }
    }
    if (nested.cause instanceof Error && nested.cause.message) {
      parts.push(nested.cause.message);
    }
    return parts.join(' | ') || err.name || 'Unknown database error';
  }
}
