import { Injectable, Logger } from '@nestjs/common';
import {
  CircuitBreakerOptions,
  CircuitBreakerState,
  CircuitBreakerStateEnum,
} from './circuit-breaker.interface';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger('CircuitBreaker');
  private readonly circuits = new Map<string, CircuitBreakerState>();
  private readonly defaultOptions: CircuitBreakerOptions = {
    failureThreshold: 5,
    timeout: 60000,
    resetTimeout: 30000,
  };

  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    key: string,
    options: CircuitBreakerOptions = this.defaultOptions,
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    const circuit = this.getOrCreateCircuit(key, config);

    if (circuit.state === CircuitBreakerStateEnum.OPEN) {
      if (Date.now() < circuit.nextAttemptTime) {
        this.logger.warn(
          `Circuit breaker is open for key: ${key}, using fallback`,
        );

        if (fallback) {
          return await fallback();
        }

        throw new Error('Circuit breaker is OPEN');
      } else {
        circuit.state = CircuitBreakerStateEnum.HALF_OPEN;
        this.logger.log(`Circuit breaker is HALF_OPEN for key: ${key}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess(circuit, key);
      return result;
    } catch (error) {
      this.onFailure(circuit, key, config);
      this.logger.log(`Using fallback for key: ${key}:`, error.message);
      if (fallback) {
        this.logger.log(`Using fallback for key: ${key}`);
        return await fallback();
      }
      throw error;
    }
  }

  private getOrCreateCircuit(
    key: string,
    options: CircuitBreakerOptions,
  ): CircuitBreakerState {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        state: CircuitBreakerStateEnum.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: Date.now() + options.timeout,
      });
    }
    return this.circuits.get(key)!;
  }

  private onSuccess(circuit: CircuitBreakerState, key: string) {
    circuit.failureCount = 0;
    circuit.state = CircuitBreakerStateEnum.CLOSED;
    this.logger.log(`Circuit breaker is CLOSED for key: ${key}`);
  }

  private onFailure(
    circuit: CircuitBreakerState,
    key: string,
    options: CircuitBreakerOptions,
  ) {
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();
    if (circuit.failureCount >= options.failureThreshold) {
      circuit.state = CircuitBreakerStateEnum.OPEN;
      this.logger.warn(
        `Circuit breaker is OPEN for key: ${key}, failure count: ${circuit.failureCount}`,
      );
    }
  }

  getCircuitState(key: string): CircuitBreakerState | undefined {
    return this.circuits.get(key);
  }

  getAllCircuits(): Map<string, CircuitBreakerState> {
    return new Map(this.circuits);
  }

  resetCircuit(key: string) {
    this.circuits.delete(key);
    this.logger.log(`Circuit breaker for key: ${key} has been RESET`);
  }
}
