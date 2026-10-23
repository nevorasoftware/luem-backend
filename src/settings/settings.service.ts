import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const DEFAULT_SETTINGS: Record<string, any> = {
  business_info: {
    companyName: 'LUEM RENT A CAR',
    country: 'El Salvador',
    currency: 'USD',
    timezone: 'America/El_Salvador',
    phone: '+503 2222-0000',
    whatsapp: '+503 7777-8888',
    email: 'contacto@luemrentacar.com',
    address: 'Boulevard de Los Héroes y Calle Gabriela Mistral, San Salvador, El Salvador',
    hours: 'Lunes a Domingo: 7:00 AM - 9:00 PM',
  },
  rental_policy: {
    minDriverAge: 21,
    minRentalDays: 1,
    depositAmount: 250,
    gracePeriodHours: 2,
    termsUrl: '/terminos-y-condiciones',
    privacyUrl: '/politica-de-privacidad',
  },
  payment_instructions: {
    defaultText:
      'Depósitos o transferencias electrónicas a nuestras cuentas autorizadas:\n' +
      '• Banco Agrícola: Cuenta Corriente #003-123456-78 a nombre de LUEM S.A. DE C.V.\n' +
      '• BAC Credomatic: Cuenta Corriente #109-876543-21 a nombre de LUEM S.A. DE C.V.\n' +
      '• Transferencia 365 (UNI): Solicite el enlace o número de referencia directo por WhatsApp.\n' +
      'Por favor incluya su código de reserva en el concepto y envíe su comprobante.',
  },
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getPublicSettings(): Promise<Record<string, any>> {
    const keys = ['business_info', 'rental_policy', 'fiscal_info'];
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: keys } },
    });

    const result: Record<string, any> = {};
    for (const k of keys) {
      const found = rows.find((r) => r.key === k);
      result[k] = found ? found.value : DEFAULT_SETTINGS[k];
    }

    const bInfo = result.business_info || {};
    const rPolicy = result.rental_policy || {};
    const fInfo = result.fiscal_info || {};

    return {
      ...result,
      businessName: bInfo.companyName || 'LUEM RENT A CAR',
      taxId: bInfo.taxId || fInfo.taxId || '0614-010190-101-1',
      email: bInfo.email || 'reservas@luemrentacar.com',
      phone: bInfo.phone || '+503 2222-0000',
      whatsapp: bInfo.whatsapp || '+503 7777-8888',
      address: bInfo.address || '',
      ivaRate: fInfo.ivaRate ?? 13,
      defaultSecurityDeposit: rPolicy.depositAmount ?? 400,
      depositAmount: rPolicy.depositAmount ?? 400,
    };
  }

  async getAllSettingsAdmin(): Promise<Record<string, any>> {
    const rows = await this.prisma.setting.findMany();
    const result: Record<string, any> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      result[r.key] = r.value;
    }

    const bInfo = result.business_info || {};
    const rPolicy = result.rental_policy || {};
    const fInfo = result.fiscal_info || {};

    return {
      ...result,
      businessName: bInfo.companyName || 'LUEM RENT A CAR',
      taxId: bInfo.taxId || fInfo.taxId || '0614-010190-101-1',
      email: bInfo.email || 'reservas@luemrentacar.com',
      phone: bInfo.phone || '+503 2222-0000',
      whatsapp: bInfo.whatsapp || '+503 7777-8888',
      address: bInfo.address || '',
      ivaRate: fInfo.ivaRate ?? 13,
      defaultSecurityDeposit: rPolicy.depositAmount ?? 400,
      depositAmount: rPolicy.depositAmount ?? 400,
    };
  }

  async updateSetting(key: string, value: any, adminId?: string, adminName?: string) {
    const updated = await this.prisma.setting.upsert({
      where: { key },
      update: { value, updatedById: adminId },
      create: { key, value, updatedById: adminId },
    });

    if (adminId) {
      await this.audit.log({
        actorType: 'USUARIO',
        actorUserId: adminId,
        actorName: adminName,
        action: 'UPDATE_SETTING',
        entityType: 'Setting',
        entityId: key,
        summary: `Configuración '${key}' actualizada`,
      });
    }

    return updated;
  }

  async updateGeneralSettings(body: any, adminId: string, adminName: string) {
    const current: Record<string, any> = await this.getAllSettingsAdmin();

    let deposit = 400;
    if (body.defaultSecurityDeposit !== undefined) {
      const num = Number(body.defaultSecurityDeposit);
      deposit = num > 1000 ? num / 100 : num;
    } else if (body.depositAmount !== undefined) {
      const num = Number(body.depositAmount);
      deposit = num > 1000 ? num / 100 : num;
    } else if (current.rental_policy?.depositAmount !== undefined) {
      deposit = Number(current.rental_policy.depositAmount);
    }

    const businessInfo = {
      ...(current.business_info || DEFAULT_SETTINGS.business_info),
      companyName: body.businessName || body.companyName || current.business_info?.companyName || 'LUEM RENT A CAR',
      taxId: body.taxId || current.business_info?.taxId || '0614-010190-101-1',
      email: body.email || current.business_info?.email || 'reservas@luemrentacar.com',
      phone: body.phone || current.business_info?.phone || '+503 2222-0000',
      whatsapp: body.whatsapp || current.business_info?.whatsapp || '+503 7777-8888',
      address: body.address !== undefined ? body.address : (current.business_info?.address || ''),
    };

    const rentalPolicy = {
      ...(current.rental_policy || DEFAULT_SETTINGS.rental_policy),
      depositAmount: deposit,
      minDriverAge: body.minDriverAge !== undefined ? Number(body.minDriverAge) : (current.rental_policy?.minDriverAge || 21),
      minRentalDays: body.minRentalDays !== undefined ? Number(body.minRentalDays) : (current.rental_policy?.minRentalDays || 1),
    };

    const fiscalInfo = {
      ...(current.fiscal_info || {}),
      taxId: body.taxId || businessInfo.taxId,
      ivaRate: body.ivaRate !== undefined ? Number(body.ivaRate) : (current.fiscal_info?.ivaRate || 13),
    };

    await this.updateSetting('business_info', businessInfo, adminId, adminName);
    await this.updateSetting('rental_policy', rentalPolicy, adminId, adminName);
    await this.updateSetting('fiscal_info', fiscalInfo, adminId, adminName);

    return {
      success: true,
      business_info: businessInfo,
      rental_policy: rentalPolicy,
      fiscal_info: fiscalInfo,
      businessName: businessInfo.companyName,
      taxId: businessInfo.taxId,
      email: businessInfo.email,
      phone: businessInfo.phone,
      whatsapp: businessInfo.whatsapp,
      address: businessInfo.address,
      ivaRate: fiscalInfo.ivaRate,
      defaultSecurityDeposit: deposit,
      depositAmount: deposit,
    };
  }
}
