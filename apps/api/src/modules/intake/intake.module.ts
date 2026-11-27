import { Module } from '@nestjs/common';
import { SourcesModule } from '../inventory/sources.module.js';
import { CarSheetImportService } from './car-sheet-import.service.js';
import { IntakeController } from './intake.controller.js';
import { IntakeService } from './intake.service.js';

/** M2 Vehicle Intake. Schema: intake. */
@Module({
  imports: [SourcesModule],
  controllers: [IntakeController],
  providers: [IntakeService, CarSheetImportService],
  exports: [IntakeService],
})
export class IntakeModule {}
