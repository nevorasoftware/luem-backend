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

  async getPublicSettings() {
    const keys = ['business_info', 'rental_policy'];
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: keys } },
    });

    const result: Record<string, any> = {};
    for (const k of keys) {
      const found = rows.find((r) => r.key === k);
      result[k] = found ? found.value : DEFAULT_SETTINGS[k];
    }
    return result;
  }

  async getAllSettingsAdmin() {
    const rows = await this.prisma.setting.findMany();
    const result: Record<string, any> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  async updateSetting(key: string, value: any, adminId: string, adminName: string) {
    const updated = await this.prisma.setting.upsert({
      where: { key },
      update: { value, updatedById: adminId },
      create: { key, value, updatedById: adminId },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      actorName: adminName,
      action: 'UPDATE_SETTING',
      entityType: 'Setting',
      entityId: key,
      summary: `Configuración '${key}' actualizada`,
    });

    return updated;
  }
}
