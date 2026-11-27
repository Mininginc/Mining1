import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { MIN_PASSWORD_LENGTH, ROLES } from '@wms/shared';
import { Roles } from '../auth/decorators.js';
import { ZodPipe } from '../../common/zod-pipe.js';
import { actorFrom, type AuthedRequest } from '../../common/request-context.js';
import { UsersService } from './users.service.js';

const password = z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200);
const roles = z.array(z.enum(ROLES)).min(1).max(ROLES.length);

const createUser = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
  password,
  roles,
});

const updateUser = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    roles: roles.optional(),
    active: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body(new ZodPipe(createUser)) body: z.infer<typeof createUser>) {
    return this.users.create(actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updateUser)) body: z.infer<typeof updateUser>,
  ) {
    return this.users.update(actorFrom(req), id, body);
  }
}
