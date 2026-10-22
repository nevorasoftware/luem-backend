import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toCents, percentOf, centsToDecimal } from '../common/money';

export interface ExtraSelection {
  extraId: string;
  quantity?: number;
}

export interface QuoteInput {
  vehicleId: string;
  pickupAt: Date;
  returnAt: Date;
  pickupLocationId?: string;
  returnLocationId?: string;
  extras?: ExtraSelection[];
  discountCode?: string;
}

export interface QuoteBreakdown {
  billableDays: number;
  dailyRateCents: number;
  baseAmountCents: number;
  seasonAdjustmentCents: number;
  appliedSeasonName?: string;
  extrasTotalCents: number;
  extrasDetails: Array<{
    id: string;
    code: string;
    name: string;
    pricingType: string;
    priceCents: number;
    quantity: number;
    subtotalCents: number;
  }>;
  feesTotalCents: number;
  pickupFeeCents: number;
  returnFeeCents: number;
  discountTotalCents: number;
  discountCode?: string;
  taxTotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  // Representación decimal formateada para respuestas API
  summary: {
    dailyRate: string;
    baseAmount: string;
    extrasTotal: string;
    feesTotal: string;
    discountTotal: string;
    total: string;
    depositRequired: string;
  };
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula la duración en días facturables.
   * Regla estándar automotriz: mínimo 1 día (24 horas). Cada fracción mayor a
   * 2 horas adicionales se cuenta como un día adicional completo.
   */
  calculateBillableDays(pickupAt: Date, returnAt: Date): number {
    const diffMs = returnAt.getTime() - pickupAt.getTime();
    if (diffMs <= 0) {
      throw new BadRequestException('La fecha de devolución debe ser posterior a la de recogida.');
    }

    const hours = diffMs / (1000 * 60 * 60);
    const fullDays = Math.floor(hours / 24);
    const extraHours = hours % 24;

    // Si excede 2 horas de gracia, se cobra el día adicional
    const billable = extraHours > 2 ? fullDays + 1 : fullDays;
    return Math.max(1, billable);
  }

  async calculateQuote(input: QuoteInput): Promise<QuoteBreakdown> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      include: { category: true },
    });

    if (!vehicle || vehicle.deletedAt) {
      throw new BadRequestException('El vehículo especificado no existe o fue descontinuado.');
    }

    const billableDays = this.calculateBillableDays(input.pickupAt, input.returnAt);

    // 1. Tarifa diaria base
    let dailyRateCents = toCents(vehicle.dailyRate) || toCents(vehicle.category.dailyRate);
    if (!dailyRateCents || dailyRateCents <= 0) {
      dailyRateCents = 3500; // $35.00 fallback mínimo
    }

    // Descuento automático por volumen (semanal / mensual si está configurado)
    if (billableDays >= 30 && vehicle.monthlyRate) {
      const monthlyRateCents = toCents(vehicle.monthlyRate);
      dailyRateCents = Math.round(monthlyRateCents / 30);
    } else if (billableDays >= 7 && vehicle.weeklyRate) {
      const weeklyRateCents = toCents(vehicle.weeklyRate);
      dailyRateCents = Math.round(weeklyRateCents / 7);
    }

    let baseAmountCents = dailyRateCents * billableDays;

    // 2. Temporadas activas
    let seasonAdjustmentCents = 0;
    let appliedSeasonName: string | undefined;

    const seasons = await this.prisma.season.findMany({
      where: {
        active: true,
        OR: [{ categoryId: vehicle.categoryId }, { categoryId: null }],
        startDate: { lte: input.returnAt },
        endDate: { gte: input.pickupAt },
      },
    });

    if (seasons.length > 0) {
      const season = seasons[0];
      appliedSeasonName = season.name;
      const val = toCents(season.value);
      if (season.adjustmentType === 'PORCENTAJE') {
        seasonAdjustmentCents = percentOf(baseAmountCents, val / 100);
      } else {
        seasonAdjustmentCents = val * billableDays;
      }
      baseAmountCents += seasonAdjustmentCents;
    }

    // 3. Extras seleccionados
    const extrasDetails: QuoteBreakdown['extrasDetails'] = [];
    let extrasTotalCents = 0;

    if (input.extras && input.extras.length > 0) {
      const extraIds = input.extras.map((e) => e.extraId);
      const dbExtras = await this.prisma.extra.findMany({
        where: { id: { in: extraIds }, active: true },
      });

      for (const sel of input.extras) {
        const item = dbExtras.find((e) => e.id === sel.extraId);
        if (!item) continue;
        const qty = Math.min(Math.max(1, sel.quantity || 1), item.maxQuantity);
        const itemPriceCents = toCents(item.price);
        const subtotal =
          item.pricingType === 'POR_DIA'
            ? itemPriceCents * billableDays * qty
            : itemPriceCents * qty;

        extrasTotalCents += subtotal;
        extrasDetails.push({
          id: item.id,
          code: item.code,
          name: item.name,
          pricingType: item.pricingType,
          priceCents: itemPriceCents,
          quantity: qty,
          subtotalCents: subtotal,
        });
      }
    }

    // 4. Tarifas de ubicación
    let pickupFeeCents = 0;
    let returnFeeCents = 0;

    if (input.pickupLocationId) {
      const loc = await this.prisma.location.findUnique({ where: { id: input.pickupLocationId } });
      if (loc && loc.active) pickupFeeCents = toCents(loc.fee);
    }
    if (input.returnLocationId) {
      const loc = await this.prisma.location.findUnique({ where: { id: input.returnLocationId } });
      if (loc && loc.active) returnFeeCents = toCents(loc.fee);
    }

    const feesTotalCents = pickupFeeCents + returnFeeCents;

    // Subtotal antes de descuento
    const subtotalCents = baseAmountCents + extrasTotalCents + feesTotalCents;

    // 5. Descuentos por código
    let discountTotalCents = 0;
    let validatedDiscountCode: string | undefined;

    if (input.discountCode && input.discountCode.trim() !== '') {
      const cleanCode = input.discountCode.trim().toUpperCase();
      const disc = await this.prisma.discount.findUnique({ where: { code: cleanCode } });
      const now = new Date();

      if (
        disc &&
        disc.active &&
        (!disc.minDays || billableDays >= disc.minDays) &&
        (!disc.validFrom || disc.validFrom <= now) &&
        (!disc.validTo || disc.validTo >= now) &&
        (!disc.maxUses || disc.usedCount < disc.maxUses)
      ) {
        validatedDiscountCode = disc.code;
        const discVal = toCents(disc.value);
        if (disc.type === 'PORCENTAJE') {
          discountTotalCents = percentOf(baseAmountCents, discVal / 100);
        } else {
          discountTotalCents = Math.min(discVal, subtotalCents);
        }
      }
    }

    const totalCents = Math.max(0, subtotalCents - discountTotalCents);

    // Depósito de garantía
    const depositRequiredCents =
      toCents(vehicle.depositAmount) ||
      toCents(vehicle.category.depositAmount) ||
      25000; // $250.00 por defecto

    return {
      billableDays,
      dailyRateCents,
      baseAmountCents,
      seasonAdjustmentCents,
      appliedSeasonName,
      extrasTotalCents,
      extrasDetails,
      feesTotalCents,
      pickupFeeCents,
      returnFeeCents,
      discountTotalCents,
      discountCode: validatedDiscountCode,
      taxTotalCents: 0,
      totalCents,
      depositRequiredCents,
      summary: {
        dailyRate: centsToDecimal(dailyRateCents),
        baseAmount: centsToDecimal(baseAmountCents),
        extrasTotal: centsToDecimal(extrasTotalCents),
        feesTotal: centsToDecimal(feesTotalCents),
        discountTotal: centsToDecimal(discountTotalCents),
        total: centsToDecimal(totalCents),
        depositRequired: centsToDecimal(depositRequiredCents),
      },
    };
  }
}
