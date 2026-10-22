import { PricingService } from './pricing.service';
import { toCents, centsToDecimal, formatUSD } from '../common/money';

describe('Pricing & Money Engine', () => {
  let pricingService: PricingService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      vehicle: {
        findUnique: jest.fn(),
      },
      season: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      extra: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      location: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      discount: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    pricingService = new PricingService(mockPrisma);
  });

  it('debe calcular días facturables con regla de 2 horas de gracia', () => {
    // Exactamente 24 horas = 1 día
    const pickup = new Date('2026-11-01T10:00:00Z');
    const return1 = new Date('2026-11-02T10:00:00Z');
    expect(pricingService.calculateBillableDays(pickup, return1)).toBe(1);

    // 25.5 horas (1.5 horas adicionales, dentro de gracia <= 2h) = 1 día
    const returnGrace = new Date('2026-11-02T11:30:00Z');
    expect(pricingService.calculateBillableDays(pickup, returnGrace)).toBe(1);

    // 27 horas (> 2 horas adicionales) = 2 días
    const returnOverGrace = new Date('2026-11-02T13:00:00Z');
    expect(pricingService.calculateBillableDays(pickup, returnOverGrace)).toBe(2);
  });

  it('debe calcular cotización base en centavos enteros', async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValue({
      id: 'veh-1',
      dailyRate: '40.00',
      depositAmount: '300.00',
      category: { dailyRate: '40.00', depositAmount: '300.00' },
      deletedAt: null,
    });

    const quote = await pricingService.calculateQuote({
      vehicleId: 'veh-1',
      pickupAt: new Date('2026-11-01T10:00:00Z'),
      returnAt: new Date('2026-11-04T10:00:00Z'), // 3 días
    });

    expect(quote.billableDays).toBe(3);
    expect(quote.dailyRateCents).toBe(4000); // $40.00
    expect(quote.baseAmountCents).toBe(12000); // $120.00
    expect(quote.totalCents).toBe(12000);
    expect(quote.summary.total).toBe('120.00');
    expect(quote.depositRequiredCents).toBe(30000); // $300.00
  });

  it('debe aplicar extras por día y por renta con sus multiplicadores', async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValue({
      id: 'veh-1',
      dailyRate: '50.00',
      depositAmount: '250.00',
      category: { dailyRate: '50.00', depositAmount: '250.00' },
      deletedAt: null,
    });

    mockPrisma.extra.findMany.mockResolvedValue([
      {
        id: 'ext-silla',
        code: 'SILLA',
        name: 'Silla Bebé',
        pricingType: 'POR_DIA',
        price: '5.00',
        maxQuantity: 2,
        active: true,
      },
      {
        id: 'ext-conductor',
        code: 'COND',
        name: 'Conductor Adicional',
        pricingType: 'POR_RENTA',
        price: '15.00',
        maxQuantity: 1,
        active: true,
      },
    ]);

    const quote = await pricingService.calculateQuote({
      vehicleId: 'veh-1',
      pickupAt: new Date('2026-11-01T10:00:00Z'),
      returnAt: new Date('2026-11-03T10:00:00Z'), // 2 días
      extras: [
        { extraId: 'ext-silla', quantity: 2 }, // $5 * 2 días * 2 sillas = $20.00 (2000 centavos)
        { extraId: 'ext-conductor', quantity: 1 }, // $15 * 1 renta = $15.00 (1500 centavos)
      ],
    });

    expect(quote.billableDays).toBe(2);
    expect(quote.baseAmountCents).toBe(10000); // $100.00
    expect(quote.extrasTotalCents).toBe(3500); // $35.00
    expect(quote.totalCents).toBe(13500); // $135.00
    expect(quote.summary.total).toBe('135.00');
  });

  it('debe formatear centavos a decimal y USD correctamente', () => {
    expect(centsToDecimal(12550)).toBe('125.50');
    expect(toCents('125.50')).toBe(12550);
    expect(formatUSD(12550)).toContain('125.50');
  });
});
