import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    },
  });

  // Proxy inverso en Railway / Cloudflare
  if (env.TRUST_PROXY) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
  }

  // Seguridad HTTP y cookies
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(cookieParser());

  // Prefijo global para la API REST
  app.setGlobalPrefix('api');

  // Filtro de excepciones y validación estricta
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Documentación OpenAPI / Swagger
  if (env.swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('LUXEM RENT A CAR — API REST')
      .setDescription(
        'Documentación OpenAPI del sistema web integral de alquiler de vehículos LUXEM RENT A CAR (El Salvador).',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('luxem_session')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'LUXEM API Docs',
    });
    logger.log(`Documentación Swagger disponible en: http://localhost:${env.PORT}/api/docs`);
  }

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Servidor LUXEM Backend escuchando en puerto ${env.PORT}`);
}

bootstrap();
