import { Inject, Module, OnApplicationShutdown, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Kysely } from 'kysely';
import { CONFIG, type AppConfig } from '../config.js';
import { DB, createDb } from '../db/db.js';
import type { Database } from '../db/types.js';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { HealthController } from './health/health.controller.js';
import { OutboxService } from './outbox/outbox.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

/** M1 Platform: sign-in, roles, users, audit log, outbox, health. */
@Module({})
export class PlatformModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      imports: [JwtModule.register({ secret: config.JWT_SECRET, signOptions: { expiresIn: config.JWT_TTL_SECONDS } })],
      controllers: [HealthController, AuthController, UsersController, AuditController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: DB, useFactory: () => createDb(config.DATABASE_URL) },
        { provide: APP_GUARD, useClass: AuthGuard },
        AuditService,
        OutboxService,
        AuthService,
        UsersService,
      ],
      exports: [DB, AuditService, OutboxService],
    };
  }

  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
