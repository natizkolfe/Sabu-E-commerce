import { Controller, Get } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'inventory', schema: this.inventoryService.schema, status: 'ok' };
  }
}
