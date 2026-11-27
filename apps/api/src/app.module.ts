import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config.js';
import { PlatformModule } from './platform/platform.module.js';
import { IntakeModule } from './modules/intake/intake.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    // Business modules (M2 to M16) are added here as they are built.
    return { module: AppModule, imports: [PlatformModule.forRoot(config), IntakeModule, InventoryModule] };
  }
}
