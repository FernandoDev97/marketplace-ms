/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 60 * 60 * 24 * 365,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || '*';

      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'Access-Control-Allow-Origin',
    ],
    credentials: true,
    maxAge: 60 * 60 * 24,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Marketplace API Gateway')
    .setDescription(
      `
      API Gateway para o sistema de Marketplace com microsserviços.

      Serviços disponíveis:
      - Users Service: Autenticação e gerenciamento de usuários.
      - Products Service: Catálogo e gestão de produtos.
      - Checkout Service: Carrinho e processamento de pedidos.
      - Payments Service: Processamento de pagamentos.
      
      Autenticação:
      - User o JWT Bearer token para rotas protegidas.
      - Use Session token para validaçao da sessão.
      `,
    )
    .setVersion('1.0')
    .setContact(
      'Fernando Souza',
      'https://github.com/fernando-souza',
      'l.fernando.dev@gmail.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-session-token',
        description: 'Session token for user validation',
        in: 'header',
      },
      'Session-auth',
    )
    .addTag('Authentication', 'Endpoints para autenticação e autorização')
    .addTag('Users', 'Endpoints para gestão de usuários')
    .addTag('Products', 'Endpoints para catálogo de produtos')
    .addTag('Checkout', 'Endpoints para carrinho e pedidos')
    .addTag('Payments', 'Endpoints para processamento de pagamentos')
    .addTag('Health', 'Endpoints para monitoramento de saúde')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3005;

  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger is running on: http://localhost:${port}/api`);
}
bootstrap();
