import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodPipe } from '../../common/zod-pipe.js';
import { actorFrom, type AuthedRequest } from '../../common/request-context.js';
import { ImportRunsService } from './import-runs.service.js';

const reviewQuery = z.object({
  code: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
const resolveBody = z.object({ note: z.string().trim().max(500).optional() });

@Controller('imports')
@Roles('manager', 'warehouse', 'sales')
export class ImportsController {
  constructor(private readonly runs: ImportRunsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.runs.list(req.user!.companyId);
  }

  /** The review queue across all imports. */
  @Get('issues')
  openIssues(@Req() req: AuthedRequest, @Query(new ZodPipe(reviewQuery)) q: z.infer<typeof reviewQuery>) {
    return this.runs.openIssues(req.user!.companyId, q);
  }

  @Get('issues/counts')
  openIssueCounts(@Req() req: AuthedRequest) {
    return this.runs.openIssueCounts(req.user!.companyId);
  }

  @Post('issues/:issueId/resolve')
  @HttpCode(200)
  @Roles('manager')
  resolve(@Req() req: AuthedRequest, @Param('issueId') issueId: string, @Body(new ZodPipe(resolveBody)) body: z.infer<typeof resolveBody>) {
    if (!/^\d{1,18}$/.test(issueId)) throw new BadRequestException('Bad issue id');
    return this.runs.resolveIssue(actorFrom(req), issueId, body.note);
  }

  @Get(':id/issues')
  issues(@Req() req: AuthedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Query('open') open?: string) {
    return this.runs.issues(req.user!.companyId, id, open === 'true');
  }
}
