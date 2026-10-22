import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeDui, normalizeEmail, normalizePhone, isValidDui } from '../common/identity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Busca o crea un cliente garantizando unicidad por DUI y correo normalizados.
   */
  async findOrCreateCustomer(data: {
    fullName: string;
    dui: string;
    email: string;
    phone: string;
    address: string;
    licenseNumber?: string;
  }) {
    const normDui = normalizeDui(data.dui);
    if (!normDui) {
      throw new BadRequestException('El formato del DUI es inválido (debe contener 9 dígitos).');
    }

    const normEmail = normalizeEmail(data.email);
    const normPhone = normalizePhone(data.phone);

    // Buscar si ya existe por DUI
    let customer = await this.prisma.customer.findUnique({
      where: { dui: normDui },
    });

    if (customer) {
      if (customer.blocked) {
        throw new BadRequestException(
          `No es posible procesar solicitudes para este cliente: ${customer.blockedReason || 'cuenta restringida'}.`,
        );
      }

      // Actualizar datos de contacto recientes si cambiaron
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          fullName: data.fullName.trim(),
          email: normEmail,
          phone: normPhone,
          address: data.address.trim(),
          licenseNumber: data.licenseNumber?.trim() || customer.licenseNumber,
        },
      });

      return customer;
    }

    // Si no existe por DUI, crear nuevo cliente
    return this.prisma.customer.create({
      data: {
        fullName: data.fullName.trim(),
        dui: normDui,
        email: normEmail,
        phone: normPhone,
        address: data.address.trim(),
        licenseNumber: data.licenseNumber?.trim(),
      },
    });
  }

  async listCustomers(search?: string) {
    const where: any = {};
    if (search && search.trim()) {
      const q = search.trim();
      const normDui = normalizeDui(q);
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        normDui ? { dui: normDui } : { dui: { contains: q } },
      ];
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        _count: {
          select: {
            requests: true,
            reservations: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getCustomerDetails(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        documents: {
          include: { file: true },
          orderBy: { createdAt: 'desc' },
        },
        requests: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        reservations: {
          include: {
            vehicle: true,
            payments: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    return customer;
  }

  async updateCustomer(
    id: string,
    data: {
      fullName?: string;
      email?: string;
      phone?: string;
      address?: string;
      licenseNumber?: string;
      notes?: string;
      blocked?: boolean;
      blockedReason?: string;
    },
    adminId: string,
  ) {
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        fullName: data.fullName?.trim(),
        email: data.email ? normalizeEmail(data.email) : undefined,
        phone: data.phone ? normalizePhone(data.phone) : undefined,
        address: data.address?.trim(),
        licenseNumber: data.licenseNumber?.trim(),
        notes: data.notes,
        blocked: data.blocked,
        blockedReason: data.blocked ? data.blockedReason : null,
      },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'UPDATE_CUSTOMER',
      entityType: 'Customer',
      entityId: id,
      summary: `Cliente ${updated.fullName} actualizado${data.blocked ? ' (BLOQUEADO)' : ''}`,
    });

    return updated;
  }

  async createCustomer(
    data: {
      fullName: string;
      dui: string;
      email: string;
      phone: string;
      address?: string;
      licenseNumber?: string;
      notes?: string;
    },
    adminId: string,
  ) {
    const customer = await this.findOrCreateCustomer({
      fullName: data.fullName,
      dui: data.dui,
      email: data.email,
      phone: data.phone,
      address: data.address || '',
      licenseNumber: data.licenseNumber,
    });

    if (data.notes) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { notes: data.notes },
      });
    }

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'CREATE_CUSTOMER',
      entityType: 'Customer',
      entityId: customer.id,
      summary: `Cliente creado: ${customer.fullName} (${customer.dui})`,
    });

    return customer;
  }

  async deleteCustomer(id: string, adminId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            reservations: true,
            requests: true,
          },
        },
      },
    });

    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    if (customer._count.reservations > 0 || customer._count.requests > 0) {
      const updated = await this.prisma.customer.update({
        where: { id },
        data: { active: false, blocked: true, blockedReason: 'Inactivado por administración' },
      });
      await this.audit.log({
        actorType: 'USUARIO',
        actorUserId: adminId,
        action: 'DEACTIVATE_CUSTOMER',
        entityType: 'Customer',
        entityId: id,
        summary: `Cliente ${customer.fullName} inactivado (con reservas previas)`,
      });
      return { success: true, message: 'Cliente inactivado (conservando su historial)' };
    }

    await this.prisma.customer.delete({ where: { id } });
    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'DELETE_CUSTOMER',
      entityType: 'Customer',
      entityId: id,
      summary: `Cliente ${customer.fullName} eliminado del sistema`,
    });
    return { success: true, message: 'Cliente eliminado correctamente' };
  }
}
