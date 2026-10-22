import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DocumentType, Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { StorageService } from '../storage/storage.service';
import { PricingService } from '../pricing/pricing.service';
import { FleetService } from '../fleet/fleet.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto';
import { loadEnv } from '../config/env';
import { centsToDecimal } from '../common/money';

export interface CreateRequestDto {
  vehicleId: string;
  pickupAt: string;
  returnAt: string;
  pickupLocationId?: string;
  returnLocationId?: string;
  extras?: Array<{ extraId: string; quantity?: number }>;
  discountCode?: string;
  customerNotes?: string;
  privacyAccepted: boolean;
  // Datos personales
  fullName: string;
  dui: string;
  email: string;
  phone: string;
  address: string;
  licenseNumber?: string;
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly storage: StorageService,
    private readonly pricingService: PricingService,
    private readonly fleetService: FleetService,
    private readonly mailService: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Genera el siguiente código secuencial único anual: LUX-YYYY-000001
   */
  private async getNextRequestCode(): Promise<string> {
    const year = new Date().getFullYear();
    const counterKey = `REQUEST_${year}`;

    const counter = await this.prisma.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });

    const seq = String(counter.value).padStart(6, '0');
    return `LUX-${year}-${seq}`;
  }

  // --- Creación de Solicitud Pública ---

  async createPublicRequest(
    dto: CreateRequestDto,
    files: {
      duiFile?: Express.Multer.File;
      licenseFile?: Express.Multer.File;
      utilityBillFile?: Express.Multer.File;
    },
    clientIp?: string,
  ) {
    if (!dto.privacyAccepted) {
      throw new BadRequestException('Debe aceptar la política de privacidad y tratamiento de datos.');
    }

    if (!files.duiFile || !files.licenseFile || !files.utilityBillFile) {
      throw new BadRequestException(
        'Los 3 documentos son obligatorios: Fotografía del DUI, Licencia de conducir y Comprobante de domicilio (recibo de luz/agua).',
      );
    }

    const pickupAt = new Date(dto.pickupAt);
    const returnAt = new Date(dto.returnAt);

    if (isNaN(pickupAt.getTime()) || isNaN(returnAt.getTime())) {
      throw new BadRequestException('Las fechas seleccionadas son inválidas.');
    }
    if (pickupAt < new Date(Date.now() - 10 * 60 * 1000)) {
      throw new BadRequestException('La fecha de recogida no puede ser en el pasado.');
    }
    if (returnAt <= pickupAt) {
      throw new BadRequestException('La fecha de devolución debe ser posterior a la de recogida.');
    }

    // 1. Revalidar disponibilidad real en el backend
    const isAvail = await this.fleetService.isVehicleAvailable(dto.vehicleId, pickupAt, returnAt);
    if (!isAvail) {
      throw new BadRequestException(
        'El vehículo seleccionado no se encuentra disponible en las fechas especificadas. Por favor seleccione otro período o vehículo.',
      );
    }

    // 2. Calcular cotización oficial en el servidor
    const quote = await this.pricingService.calculateQuote({
      vehicleId: dto.vehicleId,
      pickupAt,
      returnAt,
      pickupLocationId: dto.pickupLocationId,
      returnLocationId: dto.returnLocationId,
      extras: dto.extras,
      discountCode: dto.discountCode,
    });

    // 3. Crear o asociar cliente deduplicado por DUI
    const customer = await this.customersService.findOrCreateCustomer({
      fullName: dto.fullName,
      dui: dto.dui,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
      licenseNumber: dto.licenseNumber,
    });

    // 4. Subir los 3 documentos de forma privada y segura
    const [savedDui, savedLicense, savedUtility] = await Promise.all([
      this.storage.uploadFile(files.duiFile, { visibility: 'PRIVATE' }),
      this.storage.uploadFile(files.licenseFile, { visibility: 'PRIVATE' }),
      this.storage.uploadFile(files.utilityBillFile, { visibility: 'PRIVATE' }),
    ]);

    const code = await this.getNextRequestCode();
    const rawAccessToken = randomToken(32);
    const tokenHash = sha256(rawAccessToken);
    const tokenExpiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000); // 60 días de validez

    // 5. Crear solicitud en transacción
    const bookingRequest = await this.prisma.$transaction(async (tx) => {
      const req = await tx.bookingRequest.create({
        data: {
          code,
          status: 'PENDIENTE_REVISION',
          customerId: customer.id,
          vehicleId: dto.vehicleId,
          pickupAt,
          returnAt,
          pickupLocationId: dto.pickupLocationId || null,
          returnLocationId: dto.returnLocationId || null,
          applicant: {
            fullName: dto.fullName.trim(),
            dui: dto.dui.trim(),
            email: dto.email.trim(),
            phone: dto.phone.trim(),
            address: dto.address.trim(),
            licenseNumber: dto.licenseNumber?.trim(),
          },
          extras: dto.extras || [],
          discountCode: quote.discountCode || null,
          quote: quote as any,
          estimatedTotal: new Prisma.Decimal(quote.summary.total),
          customerNotes: dto.customerNotes?.trim() || null,
          privacyAcceptedAt: new Date(),
          submittedIp: clientIp,
        },
        include: { vehicle: true },
      });

      // Crear documentos vinculados
      await tx.customerDocument.createMany({
        data: [
          { customerId: customer.id, requestId: req.id, type: DocumentType.DUI, fileId: savedDui.id },
          { customerId: customer.id, requestId: req.id, type: DocumentType.LICENCIA, fileId: savedLicense.id },
          { customerId: customer.id, requestId: req.id, type: DocumentType.COMPROBANTE_DOMICILIO, fileId: savedUtility.id },
        ],
      });

      // Crear token de acceso para el cliente
      await tx.accessToken.create({
        data: {
          requestId: req.id,
          tokenHash,
          expiresAt: tokenExpiresAt,
        },
      });

      // Registrar evento inicial
      await tx.requestEvent.create({
        data: {
          requestId: req.id,
          kind: 'ESTADO_SOLICITUD',
          toStatus: 'PENDIENTE_REVISION',
          message: 'Solicitud creada y documentación inicial recibida.',
          internal: false,
          actorType: 'CLIENTE',
          actorName: customer.fullName,
        },
      });

      return req;
    });

    const env = loadEnv();
    const trackingUrl = `${env.FRONTEND_URL}/solicitud/seguimiento?token=${rawAccessToken}`;

    // 6. Enviar correo de confirmación al cliente (asíncrono)
    this.mailService
      .sendRequestReceived({
        to: customer.email,
        customerName: customer.fullName,
        requestCode: bookingRequest.code,
        vehicleName: `${bookingRequest.vehicle.brand} ${bookingRequest.vehicle.model} (${bookingRequest.vehicle.year})`,
        pickupAt: bookingRequest.pickupAt,
        returnAt: bookingRequest.returnAt,
        trackingUrl,
        requestId: bookingRequest.id,
      })
      .catch(() => null);

    return {
      success: true,
      requestCode: bookingRequest.code,
      accessToken: rawAccessToken,
      trackingUrl,
      message: 'Solicitud enviada exitosamente. Se ha remitido un correo con los detalles y el enlace de seguimiento.',
    };
  }

  // --- Consulta Segura por Token para el Cliente ---

  async trackRequestByToken(token: string) {
    if (!token || token.trim() === '') {
      throw new BadRequestException('Token de consulta obligatorio.');
    }

    const tokenHash = sha256(token.trim());
    const access = await this.prisma.accessToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        request: {
          include: {
            vehicle: {
              include: {
                category: true,
                photos: { take: 1, orderBy: { sortOrder: 'asc' } },
              },
            },
            pickupLocation: true,
            returnLocation: true,
            documents: {
              select: {
                id: true,
                type: true,
                status: true,
                reviewNote: true,
                createdAt: true,
                fileId: true,
              },
            },
            reservation: {
              select: {
                code: true,
                status: true,
                paymentStatus: true,
                total: true,
                balanceDue: true,
                approvedAt: true,
              },
            },
            events: {
              where: { internal: false },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!access) {
      throw new NotFoundException('El enlace de consulta es inválido o ha expirado.');
    }

    // Actualizar último uso del token
    await this.prisma.accessToken.update({
      where: { id: access.id },
      data: { lastUsedAt: new Date() },
    });

    const req = access.request;
    return {
      code: req.code,
      status: req.status,
      pickupAt: req.pickupAt,
      returnAt: req.returnAt,
      pickupLocation: req.pickupLocation?.name || 'Oficina Principal',
      returnLocation: req.returnLocation?.name || 'Oficina Principal',
      vehicle: {
        brand: req.vehicle.brand,
        model: req.vehicle.model,
        year: req.vehicle.year,
        category: req.vehicle.category.name,
        photoUrl: req.vehicle.photos[0] ? `/api/storage/public/${req.vehicle.photos[0].fileId}` : null,
      },
      quote: req.quote,
      estimatedTotal: centsToDecimal(Number(req.estimatedTotal) * 100),
      infoRequestMessage: req.infoRequestMessage,
      infoRequestDocs: req.infoRequestDocs,
      documents: req.documents.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        reviewNote: d.reviewNote,
        viewUrl: `/api/storage/token/${req.id}/${d.fileId}?token=${encodeURIComponent(token)}`,
      })),
      reservation: req.reservation,
      events: req.events,
    };
  }

  // --- Subida de Documento Adicional/Corregido por el Cliente ---

  async uploadCorrectionDocument(
    token: string,
    type: DocumentType,
    file: Express.Multer.File,
  ) {
    const tokenHash = sha256(token);
    const access = await this.prisma.accessToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { request: true },
    });

    if (!access) throw new UnauthorizedException('Token inválido.');

    const req = access.request;
    if (req.status !== 'DOCUMENTACION_INCOMPLETA' && req.status !== 'PENDIENTE_REVISION') {
      throw new BadRequestException('Esta solicitud no está en estado de recepción de documentos.');
    }

    const saved = await this.storage.uploadFile(file, { visibility: 'PRIVATE' });

    await this.prisma.$transaction(async (tx) => {
      // Reemplazar documento anterior del mismo tipo
      await tx.customerDocument.updateMany({
        where: { requestId: req.id, type, status: { not: 'ACEPTADO' } },
        data: { status: 'REEMPLAZADO' },
      });

      await tx.customerDocument.create({
        data: {
          customerId: req.customerId,
          requestId: req.id,
          type,
          fileId: saved.id,
          status: 'RECIBIDO',
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: req.id,
          kind: 'DOCUMENTO',
          message: `El cliente ha subido un nuevo archivo para: ${type}`,
          internal: false,
          actorType: 'CLIENTE',
        },
      });
    });

    return { success: true, message: 'Documento recibido correctamente.' };
  }

  // --- Métodos Administrativos ---

  async listRequestsAdmin(query: {
    status?: RequestStatus;
    vehicleId?: string;
    search?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.BookingRequestWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { customer: { dui: { contains: query.search } } },
      ];
    }

    return this.prisma.bookingRequest.findMany({
      where,
      include: {
        customer: true,
        vehicle: true,
        reservation: {
          select: { code: true, status: true, paymentStatus: true, total: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getRequestDetailsAdmin(id: string) {
    const req = await this.prisma.bookingRequest.findUnique({
      where: { id },
      include: {
        customer: true,
        vehicle: { include: { category: true } },
        pickupLocation: true,
        returnLocation: true,
        documents: {
          include: { file: true },
          orderBy: { createdAt: 'desc' },
        },
        reservation: {
          include: {
            payments: { orderBy: { createdAt: 'desc' } },
            charges: true,
          },
        },
        events: { orderBy: { createdAt: 'desc' } },
        emails: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!req) throw new NotFoundException('Solicitud no encontrada.');
    return req;
  }

  async requestMoreInfo(
    requestId: string,
    message: string,
    docs: DocumentType[],
    adminId: string,
    adminName: string,
  ) {
    const req = await this.prisma.bookingRequest.findUnique({
      where: { id: requestId },
      include: { customer: true },
    });
    if (!req) throw new NotFoundException('Solicitud no encontrada.');

    // Generar o renovar access token para el cliente
    const rawToken = randomToken(32);
    const tokenHash = sha256(rawToken);

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingRequest.update({
        where: { id: requestId },
        data: {
          status: 'DOCUMENTACION_INCOMPLETA',
          infoRequestMessage: message,
          infoRequestDocs: docs,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });

      await tx.accessToken.create({
        data: {
          requestId,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId,
          kind: 'ESTADO_SOLICITUD',
          fromStatus: req.status,
          toStatus: 'DOCUMENTACION_INCOMPLETA',
          message: `Se solicitó documentación adicional: ${message}`,
          internal: false,
          actorType: 'USUARIO',
          actorUserId: adminId,
          actorName: adminName,
        },
      });
    });

    const env = loadEnv();
    const trackingUrl = `${env.FRONTEND_URL}/solicitud/seguimiento?token=${rawToken}`;

    this.mailService
      .sendInfoRequired({
        to: req.customer.email,
        customerName: req.customer.fullName,
        requestCode: req.code,
        message,
        trackingUrl,
        requestId: req.id,
      })
      .catch(() => null);

    return { success: true, message: 'Solicitud actualizada y correo enviado al cliente.' };
  }

  async rejectRequest(requestId: string, reason: string, adminId: string, adminName: string) {
    const req = await this.prisma.bookingRequest.findUnique({
      where: { id: requestId },
      include: { customer: true },
    });
    if (!req) throw new NotFoundException('Solicitud no encontrada.');

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingRequest.update({
        where: { id: requestId },
        data: {
          status: 'RECHAZADA',
          rejectionReason: reason,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });

      // Liberar retenciones si las hubiera
      await tx.vehicleBlock.updateMany({
        where: { requestId, active: true },
        data: { active: false },
      });

      await tx.requestEvent.create({
        data: {
          requestId,
          kind: 'ESTADO_SOLICITUD',
          fromStatus: req.status,
          toStatus: 'RECHAZADA',
          message: `Solicitud rechazada: ${reason}`,
          internal: false,
          actorType: 'USUARIO',
          actorUserId: adminId,
          actorName: adminName,
        },
      });
    });

    this.mailService
      .sendRequestRejected({
        to: req.customer.email,
        customerName: req.customer.fullName,
        requestCode: req.code,
        reason,
        requestId: req.id,
      })
      .catch(() => null);

    return { success: true, message: 'Solicitud rechazada.' };
  }

  async addInternalNote(requestId: string, note: string, adminId: string, adminName: string) {
    await this.prisma.requestEvent.create({
      data: {
        requestId,
        kind: 'NOTA',
        message: note,
        internal: true,
        actorType: 'USUARIO',
        actorUserId: adminId,
        actorName: adminName,
      },
    });
    return { success: true };
  }
}
