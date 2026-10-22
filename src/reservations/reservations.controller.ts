import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ReservationsService } from './reservations.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentMethod, PaymentStatus, PaymentType, ReservationStatus, UserRole } from '@prisma/client';

@Controller('reservations')
@UseGuards(AuthGuard, RolesGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get()
  async list(
    @Query('status') status?: ReservationStatus,
    @Query('paymentStatus') paymentStatus?: PaymentStatus,
    @Query('vehicleId') vehicleId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
  ) {
    return this.reservationsService.listReservations({
      status,
      paymentStatus,
      vehicleId,
      customerId,
      search,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get(':id')
  async getDetails(@Param('id') id: string) {
    return this.reservationsService.getReservationDetails(id);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('approve')
  async approveRequest(
    @Body() body: {
      requestId: string;
      assignedVehicleId?: string;
      paymentDueHours?: number;
      paymentInstructions?: string;
    },
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.reservationsService.approveRequest({
      requestId: body.requestId,
      assignedVehicleId: body.assignedVehicleId,
      paymentDueHours: body.paymentDueHours,
      paymentInstructions: body.paymentInstructions,
      adminId,
      adminName,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR, UserRole.FINANZAS)
  @Post(':id/payments')
  @UseInterceptors(FileInterceptor('receiptFile', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async registerPayment(
    @Param('id') reservationId: string,
    @UploadedFile() receiptFile: Express.Multer.File,
    @Body() body: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.reservationsService.registerPayment({
      reservationId,
      amount: Number(body.amount),
      type: body.type as PaymentType,
      method: body.method as PaymentMethod,
      paidAt: body.paidAt,
      reference: body.reference,
      notes: body.notes,
      receiptFile,
      adminId,
      adminName,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post(':id/handover')
  @UseInterceptors(FilesInterceptor('photos', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async registerHandover(
    @Param('id') reservationId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @Body() body: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    let accessories = [];
    if (body.accessories) {
      accessories = typeof body.accessories === 'string' ? JSON.parse(body.accessories) : body.accessories;
    }

    return this.reservationsService.registerHandover({
      reservationId,
      odometerKm: Number(body.odometerKm),
      fuelLevel: Number(body.fuelLevel),
      exteriorCondition: body.exteriorCondition || 'Bueno',
      interiorCondition: body.interiorCondition || 'Bueno',
      accessories,
      notes: body.notes,
      photos,
      customerName: body.customerName,
      adminId,
      adminName,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post(':id/return')
  @UseInterceptors(FilesInterceptor('photos', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async registerReturn(
    @Param('id') reservationId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @Body() body: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    let additionalCharges = [];
    if (body.additionalCharges) {
      additionalCharges =
        typeof body.additionalCharges === 'string'
          ? JSON.parse(body.additionalCharges)
          : body.additionalCharges;
    }

    return this.reservationsService.registerReturn({
      reservationId,
      odometerKm: Number(body.odometerKm),
      fuelLevel: Number(body.fuelLevel),
      exteriorCondition: body.exteriorCondition || 'Bueno',
      interiorCondition: body.interiorCondition || 'Bueno',
      damages: body.damages,
      notes: body.notes,
      additionalCharges,
      photos,
      adminId,
      adminName,
    });
  }
}
