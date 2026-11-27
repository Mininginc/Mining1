import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod-pipe.js';
import { actorFrom, requestMeta, type AuthedRequest } from '../../common/request-context.js';
import { Public } from './decorators.js';
import { AuthService } from './auth.service.js';

const login = z.object({
  company: z.string().trim().max(49).optional(),
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
const mfaCode = z.object({ code: z.string().regex(/^\d{6}$/) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Req() req: AuthedRequest, @Body(new ZodPipe(login)) body: z.infer<typeof login>) {
    return this.auth.login(requestMeta(req), body);
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return this.auth.me(req.user!.companyId, req.user!.id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@Req() req: AuthedRequest) {
    return this.auth.setupMfa(actorFrom(req), req.user!.id);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  enableMfa(@Req() req: AuthedRequest, @Body(new ZodPipe(mfaCode)) body: z.infer<typeof mfaCode>) {
    return this.auth.enableMfa(actorFrom(req), req.user!.id, body.code);
  }
}
