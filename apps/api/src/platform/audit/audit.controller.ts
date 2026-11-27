import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodPipe } from '../../common/zod-pipe.js';
import { AuditService } from './audit.service.js';

const query = z.object({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('admin', 'manager')
  list(@Query(new ZodPipe(query)) q: z.infer<typeof query>) {
    return this.audit.list(q);
  }
}
