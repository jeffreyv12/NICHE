import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetEnvCacheForTests, envSchema, parseEnv } from '../src/env';

const REQUIRED_MIN: Record<string, string> = {
  PRIMARY_TENANT_HOSTNAME: 'expertgids.local',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40),
  DATABASE_URL: 'postgres://x',
  DATABASE_POOL_URL: 'postgres://x',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('envSchema — direct parsing', () => {
  it('passes with the required minimum', () => {
    const r = envSchema.safeParse(REQUIRED_MIN);
    expect(r.success).toBe(true);
  });

  it('parses booleans from "true"/"false"/"0"/"1"', () => {
    const r = envSchema.parse({
      ...REQUIRED_MIN,
      FEATURE_AUTO_DOMAIN_REGISTRATION: 'true',
      FEATURE_BATCH_API: '0',
      FEATURE_PROMPT_CACHE: '1',
    });
    expect(r.FEATURE_AUTO_DOMAIN_REGISTRATION).toBe(true);
    expect(r.FEATURE_BATCH_API).toBe(false);
    expect(r.FEATURE_PROMPT_CACHE).toBe(true);
  });

  it('splits ADMIN_ALLOWED_EMAILS on comma', () => {
    const r = envSchema.parse({
      ...REQUIRED_MIN,
      ADMIN_ALLOWED_EMAILS: 'a@b.com, c@d.com ,X@Y.com',
    });
    expect(r.ADMIN_ALLOWED_EMAILS).toEqual(['a@b.com', 'c@d.com', 'x@y.com']);
  });

  it('rejects missing required keys', () => {
    const r = envSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('coerces numeric envs', () => {
    const r = envSchema.parse({
      ...REQUIRED_MIN,
      CLAUDE_MONTHLY_BUDGET_EUR: '500',
      CLAUDE_PER_CALL_CAP_EUR: '10.5',
    });
    expect(r.CLAUDE_MONTHLY_BUDGET_EUR).toBe(500);
    expect(r.CLAUDE_PER_CALL_CAP_EUR).toBe(10.5);
  });
});

describe('parseEnv() — exits on bad env', () => {
  const origExit = process.exit;
  const origEnv = { ...process.env };

  beforeEach(() => {
    _resetEnvCacheForTests();
    // Wipe required keys so parsing fails.
    for (const k of Object.keys(REQUIRED_MIN)) delete process.env[k];
  });

  afterEach(() => {
    process.exit = origExit;
    process.env = { ...origEnv };
    _resetEnvCacheForTests();
  });

  it('calls process.exit(1) on validation failure', () => {
    const exitMock = vi.fn(() => undefined as never);
    process.exit = exitMock as unknown as typeof process.exit;
    const errMock = vi.spyOn(console, 'error').mockImplementation(() => {});
    parseEnv();
    expect(exitMock).toHaveBeenCalledWith(1);
    errMock.mockRestore();
  });
});
