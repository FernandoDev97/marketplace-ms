import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [ProxyService],
  exports: [ProxyService],
  controllers: [],
})
export class ProxyModule {}
