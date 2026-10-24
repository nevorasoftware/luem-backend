import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { Request } from 'express';
import { RequestsService } from './requests.service';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DocumentType, RequestStatus, UserRole } from '@prisma/client';

@Controller('requests')
@UseGuards(AuthGuard, RolesGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  // --- Endpoints Públicos ---

  @Public()
  @Post('public')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'duiFile', maxCount: 1 },
        { name: 'licenseFile', maxCount: 1 },
        { name: 'utilityBillFile', maxCount: 1 },
        { name: 'duiFront', maxCount: 1 },
        { name: 'duiBack', maxCount: 1 },
        { name: 'licenseFront', maxCount: 1 },
        { name: 'utilityBill', maxCount: 1 },
      ],
      { limits: { fileSize: 12 * 1024 * 1024 } }, // 12MB límite seguro
    ),
  )
  async createPublicRequest(
    @UploadedFiles()
    files: {
      duiFile?: Express.Multer.File[];
      licenseFile?: Express.Multer.File[];
      utilityBillFile?: Express.Multer.File[];
      duiFront?: Express.Multer.File[];
      duiBack?: Express.Multer.File[];
      licenseFront?: Express.Multer.File[];
      utilityBill?: Express.Multer.File[];
    },
    @Body() body: any,
    @Req() req: Request,
  ) {
    let extras = [];
    if (body.extras) {
      extras = typeof body.extras === 'string' ? JSON.parse(body.extras) : body.extras;
    } else if (body['extraIds[]'] || body.extraIds) {
      const rawExtras = body['extraIds[]'] || body.extraIds;
      const ids = Array.isArray(rawExtras) ? rawExtras : [rawExtras];
      extras = ids.map((id: string) => ({ extraId: id, quantity: 1 }));
    }

    const dto = {
      vehicleId: body.vehicleId,
      pickupAt: body.pickupAt || body.pickupDate,
      returnAt: body.returnAt || body.returnDate,
      pickupLocationId: body.pickupLocationId || body.pickupLocation,
      returnLocationId: body.returnLocationId || body.returnLocation,
      extras,
      discountCode: body.discountCode,
      customerNotes: body.customerNotes || body.comments,
      privacyAccepted:
        body.privacyAccepted === 'true' ||
        body.privacyAccepted === true ||
        body.acceptTerms === 'true' ||
        body.acceptTerms === true,
      fullName: body.fullName,
      dui: body.dui || body.documentNumber,
      email: body.email,
      phone: body.phone,
      address: body.address || 'El Salvador',
      licenseNumber: body.licenseNumber || body.driverLicenseNumber,
    };

    const clientIp = req.ip || req.socket.remoteAddress;

    return this.requestsService.createPublicRequest(
      dto,
      {
        duiFile: files?.duiFile?.[0] || files?.duiFront?.[0],
        licenseFile: files?.licenseFile?.[0] || files?.licenseFront?.[0],
        utilityBillFile: files?.utilityBillFile?.[0] || files?.utilityBill?.[0],
      },
      clientIp,
    );
  }


  @Public()
  @Get('track')
  async trackRequest(@Query('token') token: string) {
    return this.requestsService.trackRequestByToken(token);
  }

  @Public()
  @Post('upload-correction')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  async uploadCorrection(
    @Query('token') token: string,
    @Body('type') type: DocumentType,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.requestsService.uploadCorrectionDocument(token, type, file);
  }

  // --- Endpoints Administrativos ---

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get(['', 'admin'])
  async listAdminRequests(
    @Query('status') status?: RequestStatus,
    @Query('vehicleId') vehicleId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.requestsService.listRequestsAdmin({ status, vehicleId, search, from, to });
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get('admin/:id')
  async getAdminRequestDetails(@Param('id') id: string) {
    return this.requestsService.getRequestDetailsAdmin(id);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('admin/:id/request-info')
  async requestMoreInfo(
    @Param('id') id: string,
    @Body() body: { message: string; docs: DocumentType[] },
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.requestsService.requestMoreInfo(id, body.message, body.docs, adminId, adminName);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('admin/:id/reject')
  async rejectRequest(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.requestsService.rejectRequest(id, reason, adminId, adminName);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('admin/:id/note')
  async addNote(
    @Param('id') id: string,
    @Body('note') note: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.requestsService.addInternalNote(id, note, adminId, adminName);
  }
}
