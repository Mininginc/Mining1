import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import type { AuthedRequest } from '../../common/request-context.js';
import { ImportRunsService } from './import-runs.service.js';

@Controller('imports')
@Roles('manager', 'warehouse', 'sales')
export class ImportsController {
  constructor(private readonly runs: ImportRunsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.runs.list(req.user!.companyId);
  }

  @Get(':id/issues')
  issues(@Req() req: AuthedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Query('open') open?: string) {
    return this.runs.issues(req.user!.companyId, id, open === 'true');
  }
}
