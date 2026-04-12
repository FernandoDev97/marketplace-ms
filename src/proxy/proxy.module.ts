import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { HttpModule } from '@nestjs/axios';
import { CircuitBreakerModule } from 'src/common/circuit-breaker/circuit-breaker.module';
import { FallbackModule } from 'src/common/fallback/fallback.module';
import { TimeoutModule } from 'src/common/timeout/timeout.module';
import { RetryModule } from 'src/common/retry/retry.module';

@Module({
  imports: [
    HttpModule,
    CircuitBreakerModule,
    FallbackModule,
    TimeoutModule,
    RetryModule,
  ],
  providers: [ProxyService],
  exports: [ProxyService],
  controllers: [],
})
export class ProxyModule {}
