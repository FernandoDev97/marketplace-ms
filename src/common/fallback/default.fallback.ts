import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DefaultFallbackService {
  private readonly logger = new Logger(DefaultFallbackService.name);

  createDefaultFallback<T>(
    defaultResponse: T,
    serviceName: string,
  ): () => Promise<T> {
    return async (): Promise<T> => {
      this.logger.warn(`Usando fallback padrão para ${serviceName}`);

      return defaultResponse;
    };
  }

  createErrorFallback(
    serviceName: string,
    errorMessage: string,
  ): () => Promise<never> {
    return async (): Promise<never> => {
      this.logger.error(`Erro no fallback para ${serviceName}: ${errorMessage}`);
      throw new Error(`${serviceName} service unavailable: ${errorMessage}`);
    };
  }

  createEmptyArrayFallback<T>(serviceName: string): () => Promise<T[]> {
    return async (): Promise<T[]> => {
      this.logger.warn(`Usando fallback de array vazio para ${serviceName}`);

      return [];
    };
  }

  createEmptyObjectFallback<T>(serviceName: string): () => Promise<T> {
    return async (): Promise<T> => {
      this.logger.warn(`Usando fallback de objeto vazio para ${serviceName}`);

      return {} as T;
    };
  }
}
