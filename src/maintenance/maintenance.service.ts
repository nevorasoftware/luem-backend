import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaintenanceStatus, MaintenanceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { toCents, centsToDecimal } from '../common/money';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async createMaintenance(params: {
    vehicleId: string;
    type: MaintenanceType;
    startAt: string;
    endAt?: string;
    odometerKm?: number;
    description: string;
    provider?: string;
    cost?: number;
    invoiceRef?: string;
    nextDueDate?: string;
    nextDueKm?: number;
    blocksAvailability?: boolean;
    notes?: string;
    attachmentFile?: Express.Multer.File;
    adminId: string;
    adminName: string;
  }) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: params.vehicleId },
    });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');

    const startAt = new Date(params.startAt);
    const endAt = params.endAt ? new Date(params.endAt) : new Date(startAt.getTime() + 24 * 3600 * 1000);
    const blocks = params.blocksAvailability !== false;

    // Verificar si existen reservas confirmadas que coincidan en el período
    const conflictingReservations = await this.prisma.reservation.findMany({
      where: {
        vehicleId: params.vehicleId,
        status: { in: ['CONFIRMADA', 'EN_CURSO', 'PENDIENTE_PAGO'] },
        pickupAt: { lt: endAt },
        returnAt: { gt: startAt },
      },
    });

    const hasConflict = conflictingReservations.length > 0;
    const conflictNote = hasConflict
      ? `ALERTA: Coincide con ${conflictingReservations.length} reserva(s) existente(s): ${conflictingReservations.map((r) => r.code).join(', ')}.`
      : null;

    let attachmentFileId: string | null = null;
    if (params.attachmentFile) {
      const saved = await this.storage.uploadFile(params.attachmentFile, { visibility: 'PRIVATE' });
      attachmentFileId = saved.id;
    }

    const costDecimal = params.cost ? new Prisma.Decimal(centsToDecimal(toCents(params.cost))) : null;

    const maintenance = await this.prisma.$transaction(async (tx) => {
      const m = await tx.maintenance.create({
        data: {
          vehicleId: params.vehicleId,
          type: params.type,
          status: 'PROGRAMADO',
          startAt,
          endAt,
          odometerKm: params.odometerKm ? Number(params.odometerKm) : vehicle.odometerKm,
          description: params.description.trim(),
          provider: params.provider?.trim(),
          cost: costDecimal,
          invoiceRef: params.invoiceRef?.trim(),
          nextDueDate: params.nextDueDate ? new Date(params.nextDueDate) : null,
          nextDueKm: params.nextDueKm ? Number(params.nextDueKm) : null,
          blocksAvailability: blocks,
          notes: params.notes,
          conflictResolution: conflictNote,
          createdById: params.adminId,
        },
      });

      if (attachmentFileId) {
        await tx.maintenanceAttachment.create({
          data: { maintenanceId: m.id, fileId: attachmentFileId },
        });
      }

      // Si bloquea disponibilidad, registrar bloqueo y actualizar estado operativo
      if (blocks) {
        await tx.vehicleBlock.create({
          data: {
            vehicleId: params.vehicleId,
            kind: 'MANTENIMIENTO',
            startAt,
            endAt,
            active: true,
            maintenanceId: m.id,
          },
        });

        await tx.vehicle.update({
          where: { id: params.vehicleId },
          data: { operationalStatus: 'EN_MANTENIMIENTO' },
        });
      }

      return m;
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: params.adminId,
      actorName: params.adminName,
      action: 'CREATE_MAINTENANCE',
      entityType: 'Maintenance',
      entityId: maintenance.id,
      summary: `Mantenimiento ${params.type} registrado para vehículo ${vehicle.plate}. ${conflictNote || ''}`,
    });

    return { maintenance, conflictWarning: conflictNote };
  }

  async listMaintenance(query: { vehicleId?: string; status?: MaintenanceStatus }) {
    const where: Prisma.MaintenanceWhereInput = {};
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.status) where.status = query.status;

    return this.prisma.maintenance.findMany({
      where,
      include: {
        vehicle: true,
        attachments: { include: { file: true } },
      },
      orderBy: { startAt: 'desc' },
      take: 100,
    });
  }

  async completeMaintenance(id: string, notes?: string, adminId?: string, adminName?: string) {
    const m = await this.prisma.maintenance.findUnique({
      where: { id },
      include: { vehicle: true },
    });
    if (!m) throw new NotFoundException('Mantenimiento no encontrado.');

    await this.prisma.$transaction(async (tx) => {
      await tx.maintenance.update({
        where: { id },
        data: {
          status: 'COMPLETADO',
          endAt: new Date(),
          notes: notes ? `${m.notes ? m.notes + '\n' : ''}${notes}` : m.notes,
        },
      });

      // Desactivar bloqueo del calendario
      await tx.vehicleBlock.updateMany({
        where: { maintenanceId: id },
        data: { active: false },
      });

      // Retornar vehículo a OPERATIVO
      await tx.vehicle.update({
        where: { id: m.vehicleId },
        data: { operationalStatus: 'OPERATIVO' },
      });
    });

    if (adminId) {
      await this.audit.log({
        actorType: 'USUARIO',
        actorUserId: adminId,
        actorName: adminName,
        action: 'COMPLETE_MAINTENANCE',
        entityType: 'Maintenance',
        entityId: id,
        summary: `Mantenimiento completado para vehículo ${m.vehicle.plate}`,
      });
    }

    return { success: true, message: 'Mantenimiento marcado como completado y vehículo disponible.' };
  }

  async cancelMaintenance(id: string, notes?: string, adminId?: string, adminName?: string) {
    const m = await this.prisma.maintenance.findUnique({
      where: { id },
      include: { vehicle: true },
    });
    if (!m) throw new NotFoundException('Mantenimiento no encontrado.');

    await this.prisma.$transaction(async (tx) => {
      await tx.maintenance.update({
        where: { id },
        data: {
          status: 'CANCELADO',
          notes: notes ? `${m.notes ? m.notes + '\n' : ''}CANCELADO: ${notes}` : m.notes,
        },
      });

      await tx.vehicleBlock.updateMany({
        where: { maintenanceId: id },
        data: { active: false },
      });

      const otherActive = await tx.maintenance.count({
        where: {
          vehicleId: m.vehicleId,
          status: { in: ['PROGRAMADO', 'EN_PROCESO'] },
          id: { not: id },
        },
      });

      if (otherActive === 0) {
        await tx.vehicle.update({
          where: { id: m.vehicleId },
          data: { operationalStatus: 'OPERATIVO' },
        });
      }
    });

    if (adminId) {
      await this.audit.log({
        actorType: 'USUARIO',
        actorUserId: adminId,
        actorName: adminName,
        action: 'CANCEL_MAINTENANCE',
        entityType: 'Maintenance',
        entityId: id,
        summary: `Mantenimiento cancelado para vehículo ${m.vehicle.plate}`,
      });
    }

    return { success: true, message: 'Mantenimiento cancelado exitosamente.' };
  }
}

