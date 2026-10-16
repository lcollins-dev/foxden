import { describe, expect, it } from 'vitest';

import { deriveTokenId, readTokenId } from '@/core/session/token-credentials';

const TOKEN_ID = 'c0a29dcf46174973da1378696e4c82ae10f723cf4f4d9f75e39f4ae3851595ab';

describe('readTokenId', () => {
  it('reads a Bearer session token id (Firefox 154+)', () => {
    expect(readTokenId(`Bearer fxs_${TOKEN_ID}`, 'sessionToken')).toBe(TOKEN_ID);
  });

  it('reads a Bearer keyFetchToken id only as a keyFetchToken', () => {
    expect(readTokenId(`Bearer fxk_${TOKEN_ID}`, 'keyFetchToken')).toBe(TOKEN_ID);
    expect(readTokenId(`Bearer fxk_${TOKEN_ID}`, 'sessionToken')).toBeNull();
  });

  it('reads a Bearer passwordChangeToken id with Mozilla`s fxpc_ prefix', () => {
    expect(readTokenId(`Bearer fxpc_${TOKEN_ID}`, 'passwordChangeToken')).toBe(TOKEN_ID);
    expect(readTokenId(`Bearer fxs_${TOKEN_ID}`, 'passwordChangeToken')).toBeNull();
  });

  it('rejects anything but 64 lowercase hex characters, as Mozilla`s strict regex does', () => {
    expect(readTokenId(`Bearer fxs_${TOKEN_ID.toUpperCase()}`, 'sessionToken')).toBeNull();
    expect(readTokenId(`Bearer fxs_${TOKEN_ID.slice(1)}`, 'sessionToken')).toBeNull();
    expect(readTokenId(`Bearer ${TOKEN_ID}`, 'sessionToken')).toBeNull();
    expect(readTokenId(undefined, 'sessionToken')).toBeNull();
  });

  it('reads the id attribute of a Hawk header (Firefox 153 and older)', () => {
    const header = `Hawk id="${TOKEN_ID}", ts="1759230000", nonce="abc", hash="aGFzaA==", mac="bWFj"`;

    expect(readTokenId(header, 'sessionToken')).toBe(TOKEN_ID);
    expect(readTokenId(header, 'keyFetchToken')).toBe(TOKEN_ID);
  });

  it('rejects a Hawk header without a valid id', () => {
    expect(readTokenId('Hawk ts="1759230000", mac="bWFj"', 'sessionToken')).toBeNull();
    expect(readTokenId('Hawk id="not-hex", mac="bWFj"', 'sessionToken')).toBeNull();
  });
});

describe('deriveTokenId', () => {
  // Mozilla vector: fxa-auth-server/lib/tokens/session_token.spec.ts.
  it('derives the session token id from its seed', () => {
    const { tokenId } = deriveTokenId(
      'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
      'sessionToken'
    );

    expect(tokenId).toBe(TOKEN_ID);
  });

  // Mozilla vector: fxa-auth-server/lib/tokens/key_fetch_token.spec.ts.
  it('derives the keyFetchToken id and keyRequestKey', () => {
    const derived = deriveTokenId('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f', 'keyFetchToken');

    expect(derived.tokenId).toBe('3d0a7c02a15a62a2882f76e39b6494b500c022a8816e048625a495718998ba60');
    expect(derived.extraKey.toString('hex')).toBe('14f338a9e8c6324d9e102d4e6ee83b209796d5c74bb734a410e729e014a4a546');
  });
});
