import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ProxyService } from './proxy/proxy.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly proxyService: ProxyService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        users: await this.proxyService.getServiceUrl('users'),
        products: await this.proxyService.getServiceUrl('products'),
        checkout: await this.proxyService.getServiceUrl('checkout'),
        payments: await this.proxyService.getServiceUrl('payments'),
      },
    };
  }
}
