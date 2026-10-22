import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InspectionType,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { toCents, centsToDecimal, formatUSD } from '../common/money';
import { loadEnv } from '../config/env';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly mailService: MailService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async getNextReservationCode(): Promise<string> {
    const year = new Date().getFullYear();
    const counterKey = `RESERVATION_${year}`;

    const counter = await this.prisma.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });

    const seq = String(counter.value).padStart(6, '0');
    return `RES-${year}-${seq}`;
  }

  // --- Aprobación Atómica de Solicitud y Asignación de Vehículo ---

  async approveRequest(params: {
    requestId: string;
    assignedVehicleId?: string;
    paymentDueHours?: number;
    paymentInstructions?: string;
    adminId: string;
    adminName: string;
  }) {
    const req = await this.prisma.bookingRequest.findUnique({
      where: { id: params.requestId },
      include: {
        customer: true,
        vehicle: true,
        reservation: true,
      },
    });

    if (!req) throw new NotFoundException('Solicitud no encontrada.');
    if (req.status === 'APROBADA' || req.reservation) {
      throw new BadRequestException('Esta solicitud ya ha sido aprobada previamente.');
    }
    if (req.status === 'RECHAZADA' || req.status === 'CANCELADA') {
      throw new BadRequestException(`No se puede aprobar una solicitud en estado ${req.status}.`);
    }

    const targetVehicleId = params.assignedVehicleId || req.vehicleId;
    const resCode = await this.getNextReservationCode();

    const paymentDueAt = params.paymentDueHours
      ? new Date(Date.now() + params.paymentDueHours * 3600 * 1000)
      : new Date(Date.now() + 48 * 3600 * 1000); // 48 horas por defecto

    // Transacción atómica: comprueba solapamientos en VehicleBlock y crea la reserva
    const reservation = await this.prisma.$transaction(async (tx) => {
      // 1. Bloquear y verificar que el vehículo no tenga conflictos de solapamiento
      const conflict = await tx.vehicleBlock.findFirst({
        where: {
          vehicleId: targetVehicleId,
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          startAt: { lt: req.returnAt },
          endAt: { gt: req.pickupAt },
        },
      });

      if (conflict) {
        throw new ConflictException(
          'Conflicto de disponibilidad: El vehículo ya tiene una reserva o bloqueo confirmado en ese período.',
        );
      }

      // 2. Recalcular cotización definitiva para el vehículo seleccionado
      const finalQuote = await this.pricingService.calculateQuote({
        vehicleId: targetVehicleId,
        pickupAt: req.pickupAt,
        returnAt: req.returnAt,
        pickupLocationId: req.pickupLocationId || undefined,
        returnLocationId: req.returnLocationId || undefined,
        extras: req.extras as any,
        discountCode: req.discountCode || undefined,
      });

      const totalDecimal = new Prisma.Decimal(finalQuote.summary.total);

      // 3. Crear Registro de Reserva
      const newReservation = await tx.reservation.create({
        data: {
          code: resCode,
          requestId: req.id,
          customerId: req.customerId,
          vehicleId: targetVehicleId,
          pickupAt: req.pickupAt,
          returnAt: req.returnAt,
          pickupLocationId: req.pickupLocationId,
          returnLocationId: req.returnLocationId,
          status: 'PENDIENTE_PAGO',
          paymentStatus: 'PENDIENTE',
          dailyRate: new Prisma.Decimal(finalQuote.summary.dailyRate),
          billableDays: finalQuote.billableDays,
          baseAmount: new Prisma.Decimal(finalQuote.summary.baseAmount),
          extrasTotal: new Prisma.Decimal(finalQuote.summary.extrasTotal),
          feesTotal: new Prisma.Decimal(finalQuote.summary.feesTotal),
          discountTotal: new Prisma.Decimal(finalQuote.summary.discountTotal),
          taxTotal: new Prisma.Decimal('0.00'),
          total: totalDecimal,
          depositRequired: new Prisma.Decimal(finalQuote.summary.depositRequired),
          amountPaid: new Prisma.Decimal('0.00'),
          balanceDue: totalDecimal,
          quote: finalQuote as any,
          paymentDueAt,
          approvedById: params.adminId,
          approvedAt: new Date(),
        },
        include: {
          vehicle: true,
          pickupLocation: true,
          returnLocation: true,
        },
      });

      // 4. Crear bloqueo de vehículo en calendario
      await tx.vehicleBlock.create({
        data: {
          vehicleId: targetVehicleId,
          kind: 'RESERVA',
          startAt: req.pickupAt,
          endAt: req.returnAt,
          active: true,
          reservationId: newReservation.id,
        },
      });

      // 5. Actualizar estado de la solicitud
      await tx.bookingRequest.update({
        where: { id: req.id },
        data: {
          status: 'APROBADA',
          reviewedById: params.adminId,
          reviewedAt: new Date(),
        },
      });

      // 6. Registrar evento en historial
      await tx.requestEvent.create({
        data: {
          requestId: req.id,
          kind: 'ESTADO_SOLICITUD',
          fromStatus: req.status,
          toStatus: 'APROBADA',
          message: `Solicitud aprobada por ${params.adminName}. Reserva generada: ${resCode}. Vehículo asignado: ${newReservation.vehicle.brand} ${newReservation.vehicle.model}.`,
          internal: false,
          actorType: 'USUARIO',
          actorUserId: params.adminId,
          actorName: params.adminName,
        },
      });

      return newReservation;
    });

    // 7. Enviar Correo de Aprobación al Cliente con instrucciones de pago
    const env = loadEnv();
    const token = await this.prisma.accessToken.findFirst({
      where: { requestId: req.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const trackingUrl = token
      ? `${env.FRONTEND_URL}/solicitud/seguimiento?token=${token.tokenHash}`
      : `${env.FRONTEND_URL}/solicitud/seguimiento`;

    const instructions =
      params.paymentInstructions ||
      'Depósito bancario o transferencia a cuentas autorizadas de LUEM RENT A CAR. Indique el código de reserva como referencia y conserve su comprobante.';

    this.mailService
      .sendBookingApproved({
        to: req.customer.email,
        customerName: req.customer.fullName,
        reservationCode: reservation.code,
        vehicleName: `${reservation.vehicle.brand} ${reservation.vehicle.model} (${reservation.vehicle.year})`,
        pickupAt: reservation.pickupAt,
        returnAt: reservation.returnAt,
        pickupLocation: reservation.pickupLocation?.name || 'Oficina Principal',
        returnLocation: reservation.returnLocation?.name || 'Oficina Principal',
        dailyRateCents: toCents(reservation.dailyRate),
        billableDays: reservation.billableDays,
        totalCents: toCents(reservation.total),
        depositRequiredCents: reservation.depositRequired ? toCents(reservation.depositRequired) : undefined,
        balanceDueCents: toCents(reservation.balanceDue),
        paymentInstructions: instructions,
        trackingUrl,
        requestId: req.id,
      })
      .catch(() => null);

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: params.adminId,
      actorName: params.adminName,
      action: 'APPROVE_RESERVATION',
      entityType: 'Reservation',
      entityId: reservation.id,
      summary: `Reserva ${reservation.code} aprobada para ${req.customer.fullName}`,
    });

    return reservation;
  }

  // --- Registro de Pagos ---

  async registerPayment(params: {
    reservationId: string;
    amount: number;
    type: PaymentType;
    method: PaymentMethod;
    paidAt?: string;
    reference?: string;
    notes?: string;
    receiptFile?: Express.Multer.File;
    adminId: string;
    adminName: string;
  }) {
    const res = await this.prisma.reservation.findUnique({
      where: { id: params.reservationId },
      include: { customer: true },
    });

    if (!res) throw new NotFoundException('Reserva no encontrada.');
    if (res.status === 'CANCELADA') {
      throw new BadRequestException('No se pueden registrar pagos en una reserva cancelada.');
    }

    const paymentAmountCents = toCents(params.amount);
    if (paymentAmountCents <= 0) {
      throw new BadRequestException('El monto del pago debe ser mayor a 0.');
    }

    let receiptFileId: string | null = null;
    if (params.receiptFile) {
      const saved = await this.storage.uploadFile(params.receiptFile, { visibility: 'PRIVATE' });
      receiptFileId = saved.id;
    }

    const currentPaidCents = toCents(res.amountPaid);
    const totalCents = toCents(res.total);

    let newPaidCents = currentPaidCents;
    if (params.type === 'REEMBOLSO') {
      newPaidCents = Math.max(0, currentPaidCents - paymentAmountCents);
    } else {
      newPaidCents = currentPaidCents + paymentAmountCents;
    }

    const newBalanceCents = Math.max(0, totalCents - newPaidCents);

    let newPaymentStatus: PaymentStatus = 'PENDIENTE';
    if (newPaidCents >= totalCents) {
      newPaymentStatus = 'PAGADO';
    } else if (newPaidCents > 0) {
      newPaymentStatus = 'PARCIAL';
    } else if (params.type === 'REEMBOLSO') {
      newPaymentStatus = newPaidCents === 0 ? 'REEMBOLSADO' : 'REEMBOLSO_PARCIAL';
    }

    // Si la reserva estaba pendiente de pago y ya se cubrió un anticipo o el total, confirmar
    let newResStatus = res.status;
    if (res.status === 'PENDIENTE_PAGO' && newPaidCents > 0) {
      newResStatus = 'CONFIRMADA';
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.create({
        data: {
          reservationId: res.id,
          type: params.type,
          method: params.method,
          amount: new Prisma.Decimal(centsToDecimal(paymentAmountCents)),
          paidAt: params.paidAt ? new Date(params.paidAt) : new Date(),
          reference: params.reference?.trim() || null,
          notes: params.notes?.trim() || null,
          receiptFileId,
          createdById: params.adminId,
        },
      });

      const updatedRes = await tx.reservation.update({
        where: { id: res.id },
        data: {
          amountPaid: new Prisma.Decimal(centsToDecimal(newPaidCents)),
          balanceDue: new Prisma.Decimal(centsToDecimal(newBalanceCents)),
          paymentStatus: newPaymentStatus,
          status: newResStatus,
          confirmedAt: newResStatus === 'CONFIRMADA' && !res.confirmedAt ? new Date() : undefined,
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: res.requestId,
          kind: 'PAGO',
          message: `Pago registrado: ${formatUSD(paymentAmountCents)} (${params.type} - ${params.method}). Saldo restante: ${formatUSD(newBalanceCents)}.`,
          internal: false,
          actorType: 'USUARIO',
          actorUserId: params.adminId,
          actorName: params.adminName,
        },
      });

      return { payment, reservation: updatedRes };
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: params.adminId,
      actorName: params.adminName,
      action: 'REGISTER_PAYMENT',
      entityType: 'PaymentTransaction',
      entityId: updated.payment.id,
      summary: `Pago de ${formatUSD(paymentAmountCents)} registrado para reserva ${res.code}`,
    });

    return updated;
  }

  // --- Operaciones de Entrega y Devolución (Inspecciones) ---

  async registerHandover(params: {
    reservationId: string;
    odometerKm: number;
    fuelLevel: number; // 0..8
    exteriorCondition: string;
    interiorCondition: string;
    accessories?: string[];
    notes?: string;
    photos?: Express.Multer.File[];
    customerName?: string;
    adminId: string;
    adminName: string;
  }) {
    const res = await this.prisma.reservation.findUnique({
      where: { id: params.reservationId },
      include: { vehicle: true },
    });

    if (!res) throw new NotFoundException('Reserva no encontrada.');
    if (res.status !== 'CONFIRMADA' && res.status !== 'PENDIENTE_PAGO') {
      throw new BadRequestException(`No se puede entregar un vehículo en reserva con estado ${res.status}.`);
    }

    const photoFiles = params.photos || [];
    const savedPhotos = await Promise.all(
      photoFiles.map((f) => this.storage.uploadFile(f, { visibility: 'PRIVATE' })),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.upsert({
        where: {
          reservationId_type: {
            reservationId: res.id,
            type: InspectionType.ENTREGA,
          },
        },
        update: {
          odometerKm: Number(params.odometerKm),
          fuelLevel: Number(params.fuelLevel),
          exteriorCondition: params.exteriorCondition,
          interiorCondition: params.interiorCondition,
          accessories: params.accessories || [],
          notes: params.notes,
          customerAccepted: true,
          customerName: params.customerName || res.customerId,
          performedById: params.adminId,
          performedAt: new Date(),
        },
        create: {
          reservationId: res.id,
          type: InspectionType.ENTREGA,
          performedAt: new Date(),
          odometerKm: Number(params.odometerKm),
          fuelLevel: Number(params.fuelLevel),
          exteriorCondition: params.exteriorCondition,
          interiorCondition: params.interiorCondition,
          accessories: params.accessories || [],
          notes: params.notes,
          customerAccepted: true,
          customerName: params.customerName || res.customerId,
          performedById: params.adminId,
        },
      });

      // Crear fotos de inspección
      if (savedPhotos.length > 0) {
        await tx.inspectionPhoto.createMany({
          data: savedPhotos.map((p: any) => ({
            inspectionId: inspection.id,
            fileId: p.id,
          })),
        });
      }

      // Actualizar estado de reserva y vehículo
      await tx.reservation.update({
        where: { id: res.id },
        data: {
          status: 'EN_CURSO',
          pickedUpAt: new Date(),
        },
      });

      await tx.vehicle.update({
        where: { id: res.vehicleId },
        data: {
          odometerKm: Number(params.odometerKm),
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: res.requestId,
          kind: 'ENTREGA',
          message: `Vehículo entregado. Kilometraje inicial: ${params.odometerKm} km. Nivel de combustible: ${params.fuelLevel}/8.`,
          internal: false,
          actorType: 'USUARIO',
          actorUserId: params.adminId,
          actorName: params.adminName,
        },
      });

      return inspection;
    });

    return { success: true, message: 'Entrega registrada correctamente.', inspection: result };
  }

  async registerReturn(params: {
    reservationId: string;
    odometerKm: number;
    fuelLevel: number;
    exteriorCondition: string;
    interiorCondition: string;
    damages?: string;
    notes?: string;
    additionalCharges?: Array<{ type: any; description: string; amount: number }>;
    photos?: Express.Multer.File[];
    adminId: string;
    adminName: string;
  }) {
    const res = await this.prisma.reservation.findUnique({
      where: { id: params.reservationId },
      include: { vehicle: true },
    });

    if (!res) throw new NotFoundException('Reserva no encontrada.');
    if (res.status !== 'EN_CURSO') {
      throw new BadRequestException('Solo se puede registrar devolución de una reserva "EN_CURSO".');
    }

    const photoFiles = params.photos || [];
    const savedPhotos = await Promise.all(
      photoFiles.map((f) => this.storage.uploadFile(f, { visibility: 'PRIVATE' })),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.upsert({
        where: {
          reservationId_type: {
            reservationId: res.id,
            type: InspectionType.DEVOLUCION,
          },
        },
        update: {
          odometerKm: Number(params.odometerKm),
          fuelLevel: Number(params.fuelLevel),
          exteriorCondition: params.exteriorCondition,
          interiorCondition: params.interiorCondition,
          damages: params.damages,
          notes: params.notes,
          performedById: params.adminId,
          performedAt: new Date(),
        },
        create: {
          reservationId: res.id,
          type: InspectionType.DEVOLUCION,
          performedAt: new Date(),
          odometerKm: Number(params.odometerKm),
          fuelLevel: Number(params.fuelLevel),
          exteriorCondition: params.exteriorCondition,
          interiorCondition: params.interiorCondition,
          damages: params.damages,
          notes: params.notes,
          performedById: params.adminId,
        },
      });

      if (savedPhotos.length > 0) {
        await tx.inspectionPhoto.createMany({
          data: savedPhotos.map((p: any) => ({
            inspectionId: inspection.id,
            fileId: p.id,
          })),
        });
      }

      // Procesar cargos adicionales (km extra, daños, combustible, etc.)
      let extraChargesCents = 0;
      if (params.additionalCharges && params.additionalCharges.length > 0) {
        for (const ch of params.additionalCharges) {
          const chCents = toCents(ch.amount);
          extraChargesCents += chCents;
          await tx.reservationCharge.create({
            data: {
              reservationId: res.id,
              type: ch.type,
              description: ch.description,
              amount: new Prisma.Decimal(centsToDecimal(chCents)),
              createdById: params.adminId,
            },
          });
        }
      }

      const newTotalCents = toCents(res.total) + extraChargesCents;
      const currentPaidCents = toCents(res.amountPaid);
      const newBalanceCents = Math.max(0, newTotalCents - currentPaidCents);

      await tx.reservation.update({
        where: { id: res.id },
        data: {
          status: 'FINALIZADA',
          returnedAt: new Date(),
          chargesTotal: new Prisma.Decimal(centsToDecimal(extraChargesCents)),
          total: new Prisma.Decimal(centsToDecimal(newTotalCents)),
          balanceDue: new Prisma.Decimal(centsToDecimal(newBalanceCents)),
          paymentStatus: newBalanceCents === 0 ? 'PAGADO' : 'PARCIAL',
        },
      });

      // Liberar bloqueo del vehículo y actualizar kilometraje
      await tx.vehicleBlock.updateMany({
        where: { reservationId: res.id },
        data: { active: false },
      });

      await tx.vehicle.update({
        where: { id: res.vehicleId },
        data: {
          odometerKm: Number(params.odometerKm),
          operationalStatus: 'OPERATIVO',
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: res.requestId,
          kind: 'DEVOLUCION',
          message: `Vehículo devuelto. Kilometraje final: ${params.odometerKm} km. Alquiler finalizado con éxito.`,
          internal: false,
          actorType: 'USUARIO',
          actorUserId: params.adminId,
          actorName: params.adminName,
        },
      });

      return inspection;
    });

    return { success: true, message: 'Devolución registrada correctamente.', inspection: result };
  }

  // --- Listado y Consulta ---

  async listReservations(query: {
    status?: ReservationStatus;
    paymentStatus?: PaymentStatus;
    vehicleId?: string;
    customerId?: string;
    search?: string;
  }) {
    const where: Prisma.ReservationWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { customer: { dui: { contains: query.search } } },
        { vehicle: { plate: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.reservation.findMany({
      where,
      include: {
        customer: true,
        vehicle: true,
        pickupLocation: true,
        returnLocation: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getReservationDetails(id: string) {
    const res = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        customer: {
          include: { documents: { include: { file: true } } },
        },
        vehicle: {
          include: { category: true, photos: { include: { file: true } } },
        },
        pickupLocation: true,
        returnLocation: true,
        payments: {
          include: { receiptFile: true },
          orderBy: { createdAt: 'desc' },
        },
        charges: { orderBy: { createdAt: 'desc' } },
        inspections: {
          include: { photos: { include: { file: true } } },
        },
        request: {
          include: { events: { orderBy: { createdAt: 'desc' } } },
        },
      },
    });

    if (!res) throw new NotFoundException('Reserva no encontrada.');
    return res;
  }
}
