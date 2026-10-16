import { describe, expect, it } from 'vitest';

import { signInReturnPath } from './signInReturnPath';

describe('signInReturnPath', () => {
  it('returns a path on this origin, with its query and hash', () => {
    expect(signInReturnPath({ redirect: '/devices' })).toBe('/devices');
    expect(signInReturnPath({ redirect: '/admin/users?page=2#top' })).toBe('/admin/users?page=2#top');
  });

  it('returns nothing when there is no single return path', () => {
    expect(signInReturnPath({})).toBeUndefined();
    expect(signInReturnPath({ redirect: null })).toBeUndefined();
    expect(signInReturnPath({ redirect: ['/devices', '/admin'] })).toBeUndefined();
    expect(signInReturnPath({ redirect: '' })).toBeUndefined();
  });

  it('refuses anything that leaves this origin', () => {
    expect(signInReturnPath({ redirect: 'https://evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '//evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/\\evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/\t/evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/.//evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/..//evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/%2e//evil.example/devices' })).toBeUndefined();
    expect(signInReturnPath({ redirect: 'javascript:alert(1)' })).toBeUndefined();
    expect(signInReturnPath({ redirect: 'devices' })).toBeUndefined();
  });

  it('refuses the sign in and invite pages themselves', () => {
    expect(signInReturnPath({ redirect: '/sign-in' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/sign-in/?redirect=/admin' })).toBeUndefined();
    expect(signInReturnPath({ redirect: '/Sign-In' })).toBeUndefined();
    expect(signInReturnPath({ redirect: `/invite/${'a'.repeat(64)}` })).toBeUndefined();
    expect(signInReturnPath({ redirect: `/Invite/${'a'.repeat(64)}/` })).toBeUndefined();
  });

  it('keeps pages that only share a prefix with them', () => {
    expect(signInReturnPath({ redirect: '/sign-in-help' })).toBe('/sign-in-help');
    expect(signInReturnPath({ redirect: '/admin/invites' })).toBe('/admin/invites');
  });
});
