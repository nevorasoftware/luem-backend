import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaintenanceService } from './maintenance.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MaintenanceStatus, MaintenanceType, UserRole } from '@prisma/client';

@Controller('maintenance')
@UseGuards(AuthGuard, RolesGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get()
  async list(
    @Query('vehicleId') vehicleId?: string,
    @Query('status') status?: MaintenanceStatus,
  ) {
    return this.maintenanceService.listMaintenance({ vehicleId, status });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post()
  @UseInterceptors(FileInterceptor('attachmentFile', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async create(
    @UploadedFile() attachmentFile: Express.Multer.File,
    @Body() body: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.maintenanceService.createMaintenance({
      vehicleId: body.vehicleId,
      type: body.type as MaintenanceType,
      startAt: body.startAt,
      endAt: body.endAt,
      odometerKm: body.odometerKm,
      description: body.description,
      provider: body.provider,
      cost: body.cost ? Number(body.cost) : undefined,
      invoiceRef: body.invoiceRef,
      nextDueDate: body.nextDueDate,
      nextDueKm: body.nextDueKm,
      blocksAvailability: body.blocksAvailability === 'true' || body.blocksAvailability === true,
      notes: body.notes,
      attachmentFile,
      adminId,
      adminName,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put(':id/complete')
  async complete(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.maintenanceService.completeMaintenance(id, notes, adminId, adminName);
  }
}
