# LUXEM RENT A CAR — Backend API

API REST para el sistema integral de alquiler de vehículos **LUXEM RENT A CAR** (El Salvador).

## 🚀 Tecnologías
- **Node.js 22 LTS** con **NestJS 11** y **TypeScript**.
- **Prisma ORM 6** con **PostgreSQL**.
- **Almacenamiento desacoplado**: Local en desarrollo / compatible con **S3** (Cloudflare R2, AWS S3) en producción.
- **Seguridad**: Autenticación con sesiones opacas en base de datos, cookies httpOnly / Bearer tokens, rate-limiting, Helmet y roles (ADMIN, OPERADOR, FINANZAS).
- **Cálculo de Precios**: Motor de cotizaciones en centavos enteros con soporte de temporadas, extras por día/renta, recargos de ubicación y descuentos.
- **Validación Documental**: Validación estricta de archivos con detección de magic bytes (JPEG, PNG, WEBP, PDF) y validación de DUI salvadoreño.
- **Correos**: Notificaciones transaccionales automáticas con soporte SMTP, Resend y Console en desarrollo.
- **Auditoría**: Registro inmutable de eventos (`audit_logs` y `request_events`).

## 📋 Variables de Entorno
Copie el archivo `.env.example` a `.env`:
```bash
cp .env.example .env
```

| Variable | Descripción | Ejemplo / Default |
|---|---|---|
| `DATABASE_URL` | URL de conexión de PostgreSQL | `postgresql://luxem:luxem@localhost:5433/luxem?schema=public` |
| `FRONTEND_URL` | URL del frontend para CORS y enlaces | `http://localhost:3000` |
| `STORAGE_DRIVER` | Driver de archivos (`local` o `s3`) | `local` |
| `MAIL_DRIVER` | Driver de correo (`console`, `smtp`, `resend`) | `console` |
| `PORT` | Puerto de escucha del backend | `4000` |

## 🛠️ Comandos de Desarrollo
```bash
# Instalar dependencias
npm install

# Generar cliente de Prisma
npx prisma generate

# Aplicar migraciones a PostgreSQL
npx prisma migrate dev

# Sembrar datos iniciales (vehículos, usuarios, ubicaciones, extras)
npm run seed

# Iniciar servidor en modo desarrollo
npm run start:dev

# Ejecutar pruebas unitarias
npm test

# Compilar para producción
npm run build
```

## 📖 Documentación OpenAPI / Swagger
Al iniciar el servidor en desarrollo, la documentación interactiva está disponible en:
```
http://localhost:4000/api/docs
```

## 🚢 Despliegue en Railway
1. Agregue un servicio **PostgreSQL** en Railway.
2. Agregue este repositorio como servicio web Node.js.
3. Configure `DATABASE_URL` apuntando a la base de datos de Railway.
4. El contenedor ejecutará automáticamente `npx prisma migrate deploy && node dist/main.js`.
