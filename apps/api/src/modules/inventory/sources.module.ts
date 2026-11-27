import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service.js';

/** M4 public piece used by M2's sheet import (sources rows). Kept separate to avoid a module cycle. */
@Module({ providers: [SourcesService], exports: [SourcesService] })
export class SourcesModule {}
