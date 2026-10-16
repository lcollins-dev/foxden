import { BadRequestException } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { stdSerializers } from 'pino-http';
import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import {
  serializeClient,
  serializeCompletedRequest,
  serializeError,
  serializeReceivedRequest,
} from '@/logger/log-serializers';

const VERIFY_HASH = 'a'.repeat(64);

const buildQueryFailedError = (): QueryFailedError => {
  const driverError = Object.assign(new Error('UNIQUE constraint failed: user.email'), {
    code: 'SQLITE_CONSTRAINT_UNIQUE',
  });

  return new QueryFailedError('INSERT INTO "user" ("verifyHash") VALUES (?)', [VERIFY_HASH], driverError);
};

describe('serializeError', () => {
  it('keeps the type, message, stack and driver code of a failed query, and drops its parameters', () => {
    const serialized = serializeError(buildQueryFailedError());

    expect(Object.keys(serialized as object)).toEqual(['type', 'message', 'stack', 'code']);
    expect(serialized).toMatchObject({
      type: 'QueryFailedError',
      message: 'UNIQUE constraint failed: user.email',
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(JSON.stringify(serialized)).not.toContain(VERIFY_HASH);
  });

  it('drops the response of an http exception, which can hold the request body', () => {
    const serialized = serializeError(new BadRequestException({ target: { authPW: VERIFY_HASH } }));

    expect(Object.keys(serialized as object)).toEqual(['type', 'message', 'stack']);
    expect(serialized).toMatchObject({ type: 'BadRequestException', message: 'Bad Request Exception' });
  });

  it('reduces an error pino has already serialized the same way', () => {
    const serialized = serializeError(stdSerializers.err(buildQueryFailedError()));

    expect(JSON.stringify(serialized)).not.toContain(VERIFY_HASH);
    expect(serialized).toMatchObject({ type: 'QueryFailedError', code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });

  it('passes a value that is not an error through', () => {
    expect(serializeError('timed out')).toBe('timed out');
    expect(serializeError([{ property: 'email' }])).toEqual([{ property: 'email' }]);
  });
});

const buildRequest = (url: string, params: Record<string, unknown> = {}): IncomingMessage =>
  Object.assign(new IncomingMessage(new Socket()), { method: 'GET', url, originalUrl: url, params });

describe('serializeReceivedRequest', () => {
  it('masks the token of the invite page and drops the params that repeat it', () => {
    const logged = serializeReceivedRequest(
      buildRequest(`/invite/${VERIFY_HASH}?utm=1`, { path: ['invite', VERIFY_HASH] })
    );

    expect(logged).toMatchObject({ method: 'GET', url: '/invite/[redacted]?utm=1' });
    expect(JSON.stringify(logged)).not.toContain(VERIFY_HASH);
  });

  it('masks the token of the password reset page', () => {
    const logged = serializeReceivedRequest(
      buildRequest(`/reset-password/${VERIFY_HASH}`, { path: ['reset-password', VERIFY_HASH] })
    );

    expect(logged).toMatchObject({ url: '/reset-password/[redacted]' });
    expect(JSON.stringify(logged)).not.toContain(VERIFY_HASH);
  });

  it('leaves every other path alone', () => {
    for (const url of [
      '/api/v1/invite/check',
      '/api/v1/admin/invite/12',
      '/invite',
      '/api/v1/password-reset/check',
      '/api/v1/admin/user/12/password-reset',
      '/auth/v1/account/login',
      '/api/v1/password-reset',
    ]) {
      expect(serializeReceivedRequest(buildRequest(url)).url).toBe(url);
    }
  });
});

describe('serializeCompletedRequest', () => {
  it('logs the method and the path without its query', () => {
    expect(serializeCompletedRequest(buildRequest('/auth/v1/account/login?keys=true&x="'))).toEqual({
      method: 'GET',
      path: '/auth/v1/account/login',
    });
  });

  it('logs only the path of an absolute-form request', () => {
    expect(serializeCompletedRequest(buildRequest('http://sync.example.com/auth/v1/account/login')).path).toBe(
      '/auth/v1/account/login'
    );
  });

  it('masks the token of a token page', () => {
    expect(serializeCompletedRequest(buildRequest(`/invite/${VERIFY_HASH}`)).path).toBe('/invite/[redacted]');
  });
});

describe('serializeClient', () => {
  it('names the client Express trusts, an IPv4-mapped address as IPv4', () => {
    expect(serializeClient(Object.assign(buildRequest('/'), { ip: '203.0.113.7' }))).toBe('203.0.113.7');
    expect(serializeClient(Object.assign(buildRequest('/'), { ip: '::ffff:203.0.113.7' }))).toBe('203.0.113.7');
    expect(serializeClient(Object.assign(buildRequest('/'), { ip: '2001:db8::1' }))).toBe('2001:db8::1');
    expect(serializeClient(Object.assign(buildRequest('/'), { ip: '2001:db8::1%br-abc' }))).toBe('2001:db8::1%br-abc');
  });

  it('logs no client for a request Express has not seen', () => {
    expect(serializeClient(buildRequest('/'))).toBeUndefined();
  });
});
