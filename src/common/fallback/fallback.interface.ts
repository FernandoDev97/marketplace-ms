export interface FallbackStrategy<T> {
  execute(key: string): Promise<T>;
}

export interface FallbackOptions<T> {
  useCache?: boolean;
  cacheTimeout?: number;
  defaultResponse?: T;
  retryCount?: number;
  retryDelay?: number;
}
