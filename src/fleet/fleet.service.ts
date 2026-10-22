import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VehicleOperationalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { toCents, centsToDecimal } from '../common/money';

export interface VehicleFilterQuery {
  categoryId?: string;
  vehicleType?: string;
  transmission?: string;
  passengers?: number;
  minPrice?: number;
  maxPrice?: number;
  pickupAt?: Date;
  returnAt?: Date;
  search?: string;
}

@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // --- Consulta de disponibilidad real en fechas ---

  /**
   * Comprueba si un vehículo tiene conflictos de reservas o mantenimientos
   * bloqueantes en el rango [startAt, endAt).
   */
  async isVehicleAvailable(vehicleId: string, startAt: Date, endAt: Date): Promise<boolean> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { operationalStatus: true, deletedAt: true },
    });

    if (!vehicle || vehicle.deletedAt || vehicle.operationalStatus !== 'OPERATIVO') {
      return false;
    }

    const now = new Date();

    // Buscar si existe algún bloque activo que solape las fechas
    const conflictingBlock = await this.prisma.vehicleBlock.findFirst({
      where: {
        vehicleId,
        active: true,
        // Si es una retención temporal, verificar que no haya expirado aún
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
        // Solapamiento de rangos: block.start < endAt AND block.end > startAt
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });

    return !conflictingBlock;
  }

  // --- Catálogo público ---

  async getPublicVehicles(query: VehicleFilterQuery) {
    const where: Prisma.VehicleWhereInput = {
      deletedAt: null,
      publicVisible: true,
      operationalStatus: 'OPERATIVO',
    };

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.vehicleType) where.vehicleType = query.vehicleType as any;
    if (query.transmission) where.transmission = query.transmission as any;
    if (query.passengers) where.passengers = { gte: Number(query.passengers) };

    if (query.search) {
      where.OR = [
        { brand: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where,
      include: {
        category: true,
        features: true,
        currentLocation: true,
        photos: {
          include: { file: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ featured: 'desc' }, { dailyRate: 'asc' }],
    });

    // Si se especificaron fechas, filtrar en memoria o por query los que tengan conflicto
    if (query.pickupAt && query.returnAt) {
      const p = new Date(query.pickupAt);
      const r = new Date(query.returnAt);

      const availableVehicles = [];
      for (const v of vehicles) {
        const ok = await this.isVehicleAvailable(v.id, p, r);
        if (ok) availableVehicles.push(v);
      }
      return availableVehicles.map(this.formatVehicleResponse);
    }

    return vehicles.map(this.formatVehicleResponse);
  }

  async getPublicVehicleBySlug(slug: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { slug, deletedAt: null, publicVisible: true },
      include: {
        category: true,
        features: true,
        currentLocation: true,
        photos: {
          include: { file: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehículo no encontrado.');
    }

    return this.formatVehicleResponse(vehicle);
  }

  private formatVehicleResponse(v: any) {
    return {
      ...v,
      dailyRate: centsToDecimal(toCents(v.dailyRate)),
      weeklyRate: v.weeklyRate ? centsToDecimal(toCents(v.weeklyRate)) : null,
      monthlyRate: v.monthlyRate ? centsToDecimal(toCents(v.monthlyRate)) : null,
      depositAmount: v.depositAmount ? centsToDecimal(toCents(v.depositAmount)) : null,
      photos: v.photos.map((p: any) => ({
        id: p.id,
        fileId: p.fileId,
        url: `/api/storage/public/${p.fileId}`,
        sortOrder: p.sortOrder,
        alt: p.alt || `${v.brand} ${v.model}`,
      })),
    };
  }

  // --- Métodos Administrativos ---

  async listVehiclesAdmin() {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { deletedAt: null },
      include: {
        category: true,
        features: true,
        currentLocation: true,
        photos: {
          include: { file: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: {
            reservations: true,
            maintenances: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return vehicles.map(this.formatVehicleResponse);
  }

  async getVehicleAdmin(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        category: true,
        features: true,
        currentLocation: true,
        photos: {
          include: { file: true },
          orderBy: { sortOrder: 'asc' },
        },
        blocks: {
          where: { active: true },
          orderBy: { startAt: 'asc' },
          take: 20,
        },
        maintenances: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!vehicle || vehicle.deletedAt) {
      throw new NotFoundException('Vehículo no encontrado.');
    }

    return this.formatVehicleResponse(vehicle);
  }

  async createVehicle(data: any, adminId: string) {
    // Generar slug único basado en marca-modelo-año-placa
    const baseSlug = `${data.brand}-${data.model}-${data.year}-${data.plate}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existingSlug = await this.prisma.vehicle.findUnique({ where: { slug: baseSlug } });
    const slug = existingSlug ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

    const featureIds: string[] = data.featureIds || [];

    const created = await this.prisma.vehicle.create({
      data: {
        slug,
        brand: data.brand.trim(),
        model: data.model.trim(),
        year: Number(data.year),
        plate: data.plate.trim().toUpperCase(),
        vin: data.vin ? data.vin.trim().toUpperCase() : null,
        color: data.color?.trim(),
        categoryId: data.categoryId,
        vehicleType: data.vehicleType,
        transmission: data.transmission,
        fuelType: data.fuelType,
        passengers: Number(data.passengers || 5),
        luggage: Number(data.luggage || 2),
        doors: data.doors ? Number(data.doors) : 4,
        airConditioning: data.airConditioning !== false,
        odometerKm: Number(data.odometerKm || 0),
        dailyRate: new Prisma.Decimal(data.dailyRate),
        weeklyRate: data.weeklyRate ? new Prisma.Decimal(data.weeklyRate) : null,
        monthlyRate: data.monthlyRate ? new Prisma.Decimal(data.monthlyRate) : null,
        depositAmount: data.depositAmount ? new Prisma.Decimal(data.depositAmount) : null,
        kmIncludedPerDay: data.kmIncludedPerDay ? Number(data.kmIncludedPerDay) : null,
        extraKmFee: data.extraKmFee ? new Prisma.Decimal(data.extraKmFee) : null,
        description: data.description,
        rentalConditions: data.rentalConditions,
        minDriverAge: data.minDriverAge ? Number(data.minDriverAge) : 21,
        internalNotes: data.internalNotes,
        operationalStatus: data.operationalStatus || 'OPERATIVO',
        featured: Boolean(data.featured),
        publicVisible: data.publicVisible !== false,
        currentLocationId: data.currentLocationId || null,
        features: featureIds.length > 0 ? {
          connect: featureIds.map((id) => ({ id })),
        } : undefined,
      },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'CREATE_VEHICLE',
      entityType: 'Vehicle',
      entityId: created.id,
      summary: `Vehículo creado: ${created.brand} ${created.model} (${created.plate})`,
    });

    return created;
  }

  async updateVehicle(id: string, data: any, adminId: string) {
    const featureIds: string[] | undefined = data.featureIds;

    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: {
        brand: data.brand?.trim(),
        model: data.model?.trim(),
        year: data.year ? Number(data.year) : undefined,
        plate: data.plate ? data.plate.trim().toUpperCase() : undefined,
        vin: data.vin !== undefined ? (data.vin ? data.vin.trim().toUpperCase() : null) : undefined,
        color: data.color?.trim(),
        categoryId: data.categoryId,
        vehicleType: data.vehicleType,
        transmission: data.transmission,
        fuelType: data.fuelType,
        passengers: data.passengers ? Number(data.passengers) : undefined,
        luggage: data.luggage ? Number(data.luggage) : undefined,
        doors: data.doors ? Number(data.doors) : undefined,
        airConditioning: data.airConditioning,
        odometerKm: data.odometerKm !== undefined ? Number(data.odometerKm) : undefined,
        dailyRate: data.dailyRate ? new Prisma.Decimal(data.dailyRate) : undefined,
        weeklyRate: data.weeklyRate ? new Prisma.Decimal(data.weeklyRate) : undefined,
        monthlyRate: data.monthlyRate ? new Prisma.Decimal(data.monthlyRate) : undefined,
        depositAmount: data.depositAmount ? new Prisma.Decimal(data.depositAmount) : undefined,
        kmIncludedPerDay: data.kmIncludedPerDay !== undefined ? (data.kmIncludedPerDay ? Number(data.kmIncludedPerDay) : null) : undefined,
        extraKmFee: data.extraKmFee ? new Prisma.Decimal(data.extraKmFee) : undefined,
        description: data.description,
        rentalConditions: data.rentalConditions,
        minDriverAge: data.minDriverAge ? Number(data.minDriverAge) : undefined,
        internalNotes: data.internalNotes,
        operationalStatus: data.operationalStatus,
        featured: data.featured,
        publicVisible: data.publicVisible,
        currentLocationId: data.currentLocationId,
        features: featureIds ? {
          set: featureIds.map((fId) => ({ id: fId })),
        } : undefined,
      },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'UPDATE_VEHICLE',
      entityType: 'Vehicle',
      entityId: id,
      summary: `Vehículo ${updated.brand} ${updated.model} (${updated.plate}) actualizado`,
    });

    return updated;
  }

  /**
   * Eliminación protegida: no se permite eliminar físicamente un vehículo
   * con reservas o pagos históricos vinculados. Se aplica soft-delete (deletedAt).
   */
  async deleteVehicle(id: string, adminId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            reservations: true,
            maintenances: true,
          },
        },
      },
    });

    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');

    if (vehicle._count.reservations > 0) {
      // Aplicar soft-delete para conservar integridad referencial histórica
      await this.prisma.vehicle.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          publicVisible: false,
          operationalStatus: 'INACTIVO',
        },
      });

      await this.audit.log({
        actorType: 'USUARIO',
        actorUserId: adminId,
        action: 'SOFT_DELETE_VEHICLE',
        entityType: 'Vehicle',
        entityId: id,
        summary: `Baja lógica del vehículo ${vehicle.plate} (posee ${vehicle._count.reservations} reservas históricas)`,
      });

      return { message: 'El vehículo posee historial de reservas; se ha desactivado y dado de baja lógica.' };
    }

    // Si no tiene historial crítico, se puede eliminar físicamente
    await this.prisma.vehicle.delete({ where: { id } });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'DELETE_VEHICLE',
      entityType: 'Vehicle',
      entityId: id,
      summary: `Vehículo ${vehicle.plate} eliminado físicamente`,
    });

    return { message: 'Vehículo eliminado correctamente.' };
  }

  // --- Subida y ordenamiento de fotos ---

  async addVehiclePhoto(vehicleId: string, file: Express.Multer.File, alt?: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');

    const storedFile = await this.storage.uploadFile(file, {
      visibility: 'PUBLIC',
      optimizeImage: true,
    });

    const maxSort = await this.prisma.vehiclePhoto.aggregate({
      where: { vehicleId },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxSort._max.sortOrder ?? -1) + 1;

    return this.prisma.vehiclePhoto.create({
      data: {
        vehicleId,
        fileId: storedFile.id,
        sortOrder: nextOrder,
        alt: alt || `${vehicle.brand} ${vehicle.model}`,
      },
      include: { file: true },
    });
  }

  async deleteVehiclePhoto(photoId: string) {
    const photo = await this.prisma.vehiclePhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Foto no encontrada.');
    await this.prisma.vehiclePhoto.delete({ where: { id: photoId } });
    return { success: true };
  }

  async reorderVehiclePhotos(vehicleId: string, photoIdsInOrder: string[]) {
    await this.prisma.$transaction(
      photoIdsInOrder.map((id, index) =>
        this.prisma.vehiclePhoto.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { success: true };
  }

  // --- Categorías, Características y Ubicaciones ---

  async listCategories() {
    return this.prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listFeatures() {
    return this.prisma.feature.findMany({ orderBy: { name: 'asc' } });
  }

  async listLocations() {
    return this.prisma.location.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
