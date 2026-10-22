import { PrismaClient, UserRole } from '@prisma/client';
import { hashPassword } from '../src/common/crypto';
import { DEFAULT_SETTINGS } from '../src/settings/settings.service';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Iniciando Seed de LUXEM RENT A CAR ---');

  // 1. Usuarios iniciales
  const adminPass = await hashPassword('Admin123456!');
  const opPass = await hashPassword('Operador123456!');
  const finPass = await hashPassword('Finanzas123456!');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@luxemrentacar.com' },
    update: {},
    create: {
      email: 'admin@luxemrentacar.com',
      fullName: 'Administrador General LUXEM',
      role: UserRole.ADMIN,
      passwordHash: adminPass,
    },
  });

  await prisma.user.upsert({
    where: { email: 'operador@luxemrentacar.com' },
    update: {},
    create: {
      email: 'operador@luxemrentacar.com',
      fullName: 'Operador de Flota',
      role: UserRole.OPERADOR,
      passwordHash: opPass,
    },
  });

  await prisma.user.upsert({
    where: { email: 'finanzas@luxemrentacar.com' },
    update: {},
    create: {
      email: 'finanzas@luxemrentacar.com',
      fullName: 'Especialista de Finanzas',
      role: UserRole.FINANZAS,
      passwordHash: finPass,
    },
  });

  console.log('✓ Usuarios administrativos creados.');

  // 2. Configuraciones del negocio
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
  console.log('✓ Configuración del negocio establecida.');

  // 3. Ubicaciones en El Salvador
  const aerop = await prisma.location.upsert({
    where: { name: 'Aeropuerto Internacional de El Salvador (SAL)' },
    update: {},
    create: {
      name: 'Aeropuerto Internacional de El Salvador (SAL)',
      address: 'Autopista a Comalapa Km 40.5, San Luis Talpa, La Paz',
      fee: 15.0, // Cargo por entrega en aeropuerto
      sortOrder: 1,
    },
  });

  const sivar = await prisma.location.upsert({
    where: { name: 'Sucursal Central — San Salvador' },
    update: {},
    create: {
      name: 'Sucursal Central — San Salvador',
      address: 'Boulevard de Los Héroes #125, San Salvador',
      fee: 0.0,
      sortOrder: 2,
    },
  });

  await prisma.location.upsert({
    where: { name: 'Sucursal Santa Ana' },
    update: {},
    create: {
      name: 'Sucursal Santa Ana',
      address: 'Avenida Independencia Sur, Santa Ana',
      fee: 10.0,
      sortOrder: 3,
    },
  });

  await prisma.location.upsert({
    where: { name: 'Sucursal San Miguel' },
    update: {},
    create: {
      name: 'Sucursal San Miguel',
      address: 'Avenida Roosevelt Norte, San Miguel',
      fee: 15.0,
      sortOrder: 4,
    },
  });

  console.log('✓ Ubicaciones de entrega y retiro creadas.');

  // 4. Categorías de vehículos
  const catSedanEcon = await prisma.category.upsert({
    where: { slug: 'sedan-economico' },
    update: {},
    create: {
      name: 'Sedán Económico',
      slug: 'sedan-economico',
      description: 'Vehículos eficientes y cómodos para ciudad y viajes ligeros.',
      dailyRate: 35.0,
      depositAmount: 250.0,
      sortOrder: 1,
    },
  });

  const catSedanExec = await prisma.category.upsert({
    where: { slug: 'sedan-ejecutivo' },
    update: {},
    create: {
      name: 'Sedán Ejecutivo',
      slug: 'sedan-ejecutivo',
      description: 'Elegancia, mayor espacio y máximo confort.',
      dailyRate: 50.0,
      depositAmount: 350.0,
      sortOrder: 2,
    },
  });

  const catSuvCompact = await prisma.category.upsert({
    where: { slug: 'suv-compacta' },
    update: {},
    create: {
      name: 'SUV Compacta',
      slug: 'suv-compacta',
      description: 'Versatilidad, altura y seguridad para recorrer el país.',
      dailyRate: 60.0,
      depositAmount: 400.0,
      sortOrder: 3,
    },
  });

  const catSuvFam = await prisma.category.upsert({
    where: { slug: 'suv-familiar-7-pasajeros' },
    update: {},
    create: {
      name: 'SUV Familiar (7 Pasajeros)',
      slug: 'suv-familiar-7-pasajeros',
      description: 'Capacidad para toda la familia con 3 filas de asientos.',
      dailyRate: 85.0,
      depositAmount: 500.0,
      sortOrder: 4,
    },
  });

  const catPickup = await prisma.category.upsert({
    where: { slug: 'pickup-4x4' },
    update: {},
    create: {
      name: 'Pick-Up 4x4 Doble Cabina',
      slug: 'pickup-4x4',
      description: 'Potencia y tracción 4x4 para playas, montañas y trabajo rudo.',
      dailyRate: 90.0,
      depositAmount: 500.0,
      sortOrder: 5,
    },
  });

  console.log('✓ Categorías creadas.');

  // 5. Características
  const featApple = await prisma.feature.upsert({
    where: { name: 'Apple CarPlay & Android Auto' },
    update: {},
    create: { name: 'Apple CarPlay & Android Auto', icon: 'smartphone' },
  });

  const featCam = await prisma.feature.upsert({
    where: { name: 'Cámara de Retroceso' },
    update: {},
    create: { name: 'Cámara de Retroceso', icon: 'camera' },
  });

  const featCruise = await prisma.feature.upsert({
    where: { name: 'Control de Crucero' },
    update: {},
    create: { name: 'Control de Crucero', icon: 'gauge' },
  });

  const feat4x4 = await prisma.feature.upsert({
    where: { name: 'Tracción 4x4 con Reductora' },
    update: {},
    create: { name: 'Tracción 4x4 con Reductora', icon: 'mountain' },
  });

  const featSensors = await prisma.feature.upsert({
    where: { name: 'Sensores de Proximidad' },
    update: {},
    create: { name: 'Sensores de Proximidad', icon: 'radar' },
  });

  // 6. Flota inicial de vehículos
  const vehiclesData = [
    {
      brand: 'Toyota',
      model: 'Corolla LE',
      year: 2024,
      plate: 'P-912834',
      vin: 'JT2BF28K3P0123456',
      color: 'Plata Metálico',
      categoryId: catSedanEcon.id,
      vehicleType: 'SEDAN',
      transmission: 'AUTOMATICA',
      fuelType: 'GASOLINA',
      passengers: 5,
      luggage: 2,
      dailyRate: 38.0,
      weeklyRate: 240.0,
      depositAmount: 250.0,
      featured: true,
      description: 'Excelente rendimiento de combustible y comodidad para desplazarse por El Salvador.',
      currentLocationId: sivar.id,
      featureConnect: [featApple.id, featCam.id],
    },
    {
      brand: 'Hyundai',
      model: 'Tucson GL',
      year: 2024,
      plate: 'P-834921',
      vin: 'KM8J33A49PU234567',
      color: 'Gris Oscuro',
      categoryId: catSuvCompact.id,
      vehicleType: 'SUV',
      transmission: 'AUTOMATICA',
      fuelType: 'GASOLINA',
      passengers: 5,
      luggage: 3,
      dailyRate: 65.0,
      weeklyRate: 410.0,
      depositAmount: 400.0,
      featured: true,
      description: 'Diseño vanguardista, interior espacioso y excelente altura para viajes turísticos.',
      currentLocationId: aerop.id,
      featureConnect: [featApple.id, featCam.id, featSensors.id],
    },
    {
      brand: 'Toyota',
      model: 'Hilux SR 4x4',
      year: 2023,
      plate: 'P-745129',
      vin: 'MROER82G801345678',
      color: 'Blanco',
      categoryId: catPickup.id,
      vehicleType: 'PICKUP',
      transmission: 'MANUAL',
      fuelType: 'DIESEL',
      passengers: 5,
      luggage: 4,
      dailyRate: 95.0,
      weeklyRate: 600.0,
      depositAmount: 500.0,
      featured: true,
      description: 'Indestructible para visitar la Ruta de Las Flores, volcanes o las playas de El Salvador.',
      currentLocationId: sivar.id,
      featureConnect: [feat4x4.id, featCam.id],
    },
    {
      brand: 'Kia',
      model: 'Sportage LX',
      year: 2024,
      plate: 'P-612984',
      vin: 'KNDPMCAC5P7456789',
      color: 'Azul Noche',
      categoryId: catSuvCompact.id,
      vehicleType: 'SUV',
      transmission: 'AUTOMATICA',
      fuelType: 'GASOLINA',
      passengers: 5,
      luggage: 3,
      dailyRate: 62.0,
      weeklyRate: 390.0,
      depositAmount: 400.0,
      featured: false,
      description: 'Comodidad, tecnología y suspensión suave para trayectos largos.',
      currentLocationId: sivar.id,
      featureConnect: [featApple.id, featCam.id, featCruise.id],
    },
    {
      brand: 'Mitsubishi',
      model: 'Montero Sport 4x4 (7 Pasajeros)',
      year: 2023,
      plate: 'P-501239',
      vin: 'MMBJRKS10PH567890',
      color: 'Negro',
      categoryId: catSuvFam.id,
      vehicleType: 'SUV',
      transmission: 'AUTOMATICA',
      fuelType: 'DIESEL',
      passengers: 7,
      luggage: 4,
      dailyRate: 90.0,
      weeklyRate: 580.0,
      depositAmount: 500.0,
      featured: true,
      description: 'La mejor opción para familias numerosas o grupos que buscan lujo y amplitud.',
      currentLocationId: aerop.id,
      featureConnect: [featApple.id, featCam.id, featSensors.id, feat4x4.id],
    },
  ];

  for (const v of vehiclesData) {
    const slug = `${v.brand}-${v.model}-${v.year}-${v.plate}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    await prisma.vehicle.upsert({
      where: { plate: v.plate },
      update: {},
      create: {
        slug,
        brand: v.brand,
        model: v.model,
        year: v.year,
        plate: v.plate,
        vin: v.vin,
        color: v.color,
        categoryId: v.categoryId,
        vehicleType: v.vehicleType as any,
        transmission: v.transmission as any,
        fuelType: v.fuelType as any,
        passengers: v.passengers,
        luggage: v.luggage,
        dailyRate: v.dailyRate,
        weeklyRate: v.weeklyRate,
        depositAmount: v.depositAmount,
        featured: v.featured,
        description: v.description,
        currentLocationId: v.currentLocationId,
        features: {
          connect: v.featureConnect.map((id) => ({ id })),
        },
      },
    });
  }

  console.log('✓ Flota inicial de vehículos creada.');

  // 7. Extras
  await prisma.extra.upsert({
    where: { code: 'SILLA_BEBE' },
    update: {},
    create: {
      code: 'SILLA_BEBE',
      name: 'Silla para Bebé / Niño',
      description: 'Silla de seguridad homologada para diferentes etapas infantiles.',
      pricingType: 'POR_DIA',
      price: 5.0,
      maxQuantity: 2,
    },
  });

  await prisma.extra.upsert({
    where: { code: 'CONDUCTOR_EXTRA' },
    update: {},
    create: {
      code: 'CONDUCTOR_EXTRA',
      name: 'Conductor Adicional',
      description: 'Autoriza a una segunda persona con licencia válida a conducir el vehículo.',
      pricingType: 'POR_RENTA',
      price: 15.0,
      maxQuantity: 1,
    },
  });

  await prisma.extra.upsert({
    where: { code: 'WIFI_PORTATIL' },
    update: {},
    create: {
      code: 'WIFI_PORTATIL',
      name: 'Wi-Fi Móvil LTE Portátil',
      description: 'Punto de acceso inalámbrico con internet ilimitado en todo El Salvador.',
      pricingType: 'POR_DIA',
      price: 7.0,
      maxQuantity: 1,
    },
  });

  console.log('✓ Extras creados.');

  console.log('=== Seed finalizado exitosamente ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
