import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './throttler.guard';

describe('CustomThrottlerGuard', () => {
  let guard: CustomThrottlerGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            ttl: 60,
            limit: 10,
          },
        ]),
      ],
      providers: [CustomThrottlerGuard],
    }).compile();

    guard = module.get<CustomThrottlerGuard>(CustomThrottlerGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return an identifying tracker based on IP and User-Agent', async () => {
    const req = {
      ip: '192.168.0.1',
      headers: {
        'user-agent': 'Mozilla/5.0 TestBrowser',
      },
    };

    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('192.168.0.1-Mozilla/5.0 TestBrowser');
  });
});
