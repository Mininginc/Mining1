import { Module } from '@nestjs/common';
import { IntakeModule } from '../intake/intake.module.js';
import { EbayCsvImportService } from './ebay-csv-import.service.js';
import { InventoryController } from './inventory.controller.js';
import { PartsService } from './parts.service.js';
import { SourcesModule } from './sources.module.js';

/** M4 Parts & Inventory. Schema: inventory. */
@Module({
  imports: [IntakeModule, SourcesModule],
  controllers: [InventoryController],
  providers: [PartsService, EbayCsvImportService],
})
export class InventoryModule {}
