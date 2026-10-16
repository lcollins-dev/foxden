import { describe, expect, it } from 'vitest';

import { parseKeyId } from './key-id';
import { TokenserverError } from './tokenserver-error';

const statusOf = (keyId: string | undefined, clientState?: string): string => {
  try {
    parseKeyId(keyId, clientState);
  } catch (error) {
    if (error instanceof TokenserverError) {
      return `${error.httpStatus} ${error.status} ${error.description}`;
    }
  }

  return 'ok';
};

describe('parseKeyId', () => {
  it('splits keys_changed_at from the hex of the fingerprint', () => {
    expect(parseKeyId('1700000000000-aulGg1ccenxU2rRwCqOZXw', undefined)).toEqual({
      keysChangedAt: 1700000000000,
      clientState: '6ae94683571c7a7c54dab4700aa3995f',
    });
  });

  // Literals from syncstorage-rs tools/integration_tests/tokenserver/test_e2e.py.
  it.each([
    ['1234-qqo', 'aaaa'],
    ['1234-u7s', 'bbbb'],
    ['1234-zMw', 'cccc'],
    ['1234-3d0', 'dddd'],
  ])('decodes %s as client state %s', (keyId, clientState) => {
    expect(parseKeyId(keyId, undefined).clientState).toBe(clientState);
  });

  it('splits on the first dash only, so the fingerprint may contain one', () => {
    expect(parseKeyId('1234-_-8', undefined).clientState).toBe(Buffer.from('_-8', 'base64url').toString('hex'));
  });

  it('treats zero as absent and accepts leading zeros', () => {
    expect(parseKeyId('0-qqo', undefined).keysChangedAt).toBeNull();
    expect(parseKeyId('0000000001234-qqo', undefined).keysChangedAt).toBe(1234);
  });

  it('allows an empty fingerprint', () => {
    expect(parseKeyId('1234-', undefined).clientState).toBe('');
  });

  it.each([
    [undefined, '401 invalid-key-id Missing X-KeyID header'],
    ['1234-qqoé', '401 invalid-key-id Invalid X-KeyID header'],
    ['1234', '401 invalid-credentials Unauthorized'],
    ['1234-qqo=', '401 invalid-credentials Unauthorized'],
    ['1234-qqp', '401 invalid-credentials Unauthorized'],
    ['1234-qq+o', '401 invalid-credentials Unauthorized'],
    ['12a4-qqo', '401 invalid-credentials Unauthorized'],
  ])('rejects %s', (keyId, expected) => {
    expect(statusOf(keyId)).toBe(expected);
  });

  it('checks X-Client-State before keys_changed_at, so its errors win', () => {
    expect(statusOf('bad-qqo', 'bbbb')).toBe('401 invalid-client-state Unauthorized');
    expect(statusOf('1234-qqo', 'not valid!')).toBe('400 error Invalid client state value');
    expect(statusOf('1234-qqo', 'aaaa')).toBe('ok');
  });
});
