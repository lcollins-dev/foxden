import { describe, expect, it } from 'vitest';

import { deriveSigningSecret, deriveTokenKey, makeToken, parseToken } from './sync-token';

// Vector A: syncstorage-rs `syncserver/src/web/auth.rs` test fixture (Python tokenlib formatting).
const MASTER_SECRET = 'Ted Koppel is a robot';
const FIXTURE_ID =
  'eyJ1aWQiOiAxLCAibm9kZSI6ICJodHRwOi8vbG9jYWxob3N0OjUwMDAiLCAiZXhwaXJlcyI6IDE4ODQ5Njg0MzkuMCwgImZ4YV91aWQiOiAiMzE5Yjk4Zjk5NjFmZjFkYmRkMDczMTNjZDZiYTkyNWEiLCAiZnhhX2tpZCI6ICJkZTY5N2FkNjZkODQ1YjI4NzNjOWQ3ZTEzYjg5NzFhZiIsICJoYXNoZWRfZnhhX3VpZCI6ICIwZThkZjVkNDEzOThhMzg5OTEzYmQ4NDAyNDM1NjQ5NTE4YWY0NjQ5M2RhMWQ0YTQzN2E0NmRjMTc4NGM1MDFhIiwgImhhc2hlZF9kZXZpY2VfaWQiOiAiMmJjYjkyZjRkNDY5OGMzZDdiMDgzYTNjNjk4YTE2Y2NkNzhiYzJhOGQyMGE5NmU0YmIxMjhkZGNlYWY0ZTBiNiIsICJzYWx0IjogIjJiMzA3YiJ9lXaC5pIOenf7qL1AWlgKFvYH63nakyniTXP-7acS5cw=';
const FIXTURE_KEY = 'dSi3EoZyHwgDp-O9OG1jRHtmbGl2M1bwcWsi04C4F58=';

// Vector C: this server's token format, computed independently with node:crypto HKDF and HMAC-SHA256.
const PLAINTEXT = {
  node: 'https://sync.example.com',
  fxa_kid: '1700000000000-aulGg1ccenxU2rRwCqOZXw',
  fxa_uid: '319b98f9961ff1dbdd07313cd6ba925a',
  hashed_device_id: 'e98b6ca7c3a980c1181454bc5cd0af71',
  hashed_fxa_uid: '049bbd59065e40fdc5e544d25e42599d',
  expires: 1900000000,
  uid: 1,
  tokenserver_origin: 'rust',
};
const TOKEN_ID =
  'eyJub2RlIjoiaHR0cHM6Ly9zeW5jLmV4YW1wbGUuY29tIiwiZnhhX2tpZCI6IjE3MDAwMDAwMDAwMDAtYXVsR2cxY2NlbnhVMnJSd0NxT1pYdyIsImZ4YV91aWQiOiIzMTliOThmOTk2MWZmMWRiZGQwNzMxM2NkNmJhOTI1YSIsImhhc2hlZF9kZXZpY2VfaWQiOiJlOThiNmNhN2MzYTk4MGMxMTgxNDU0YmM1Y2QwYWY3MSIsImhhc2hlZF9meGFfdWlkIjoiMDQ5YmJkNTkwNjVlNDBmZGM1ZTU0NGQyNWU0MjU5OWQiLCJleHBpcmVzIjoxOTAwMDAwMDAwLCJ1aWQiOjEsInRva2Vuc2VydmVyX29yaWdpbiI6InJ1c3QiLCJzYWx0IjoiYTFiMmMzIn1EZ48r8bTpRZRh6TBBrjwXDsdVqD0-PE6TtTYrkEVWyw==';
const TOKEN_KEY = 'LwE8xmjweW7fvNk_yH5xtcQdT0OPXmJ9wrh8OIlL0Eg=';

describe('sync-token', () => {
  it('derives the tokenlib signing secret', () => {
    expect(deriveSigningSecret(MASTER_SECRET).toString('hex')).toBe(
      'ca50531355a39e0d3e20e0d998b389fde44fdb5ad41a300869dec7fdff788784'
    );
  });

  it('verifies and reads a token minted by Python tokenlib', () => {
    expect(parseToken(FIXTURE_ID, deriveSigningSecret(MASTER_SECRET))).toEqual({
      uid: 1,
      expires: 1884968439,
      node: 'http://localhost:5000',
      salt: '2b307b',
    });
  });

  it('derives the Hawk key from the salt and the whole padded id', () => {
    expect(deriveTokenKey(MASTER_SECRET, '2b307b', FIXTURE_ID)).toBe(FIXTURE_KEY);
  });

  it('makes a token byte for byte like syncstorage-rs', () => {
    expect(makeToken(PLAINTEXT, MASTER_SECRET, 'a1b2c3')).toEqual({ id: TOKEN_ID, key: TOKEN_KEY });
  });

  it('salts every token differently by default', () => {
    const first = makeToken(PLAINTEXT, MASTER_SECRET);
    const second = makeToken(PLAINTEXT, MASTER_SECRET);

    expect(first.id).not.toBe(second.id);
    expect(parseToken(first.id, deriveSigningSecret(MASTER_SECRET))?.salt).toMatch(/^[0-9a-f]{6}$/);
  });

  it('rejects a token under another secret, with a changed signature, or malformed', () => {
    const signingSecret = deriveSigningSecret(MASTER_SECRET);
    const decoded = Buffer.from(FIXTURE_ID, 'base64url');
    decoded[decoded.length - 1] ^= 1;

    expect(parseToken(FIXTURE_ID, deriveSigningSecret('wibble'))).toBeNull();
    expect(parseToken(decoded.toString('base64url'), signingSecret)).toBeNull();
    expect(parseToken('not base64!', signingSecret)).toBeNull();
    expect(parseToken(Buffer.alloc(32).toString('base64url'), signingSecret)).toBeNull();
  });

  it('accepts the id with or without padding', () => {
    expect(parseToken(FIXTURE_ID.replace(/=+$/, ''), deriveSigningSecret(MASTER_SECRET))?.uid).toBe(1);
  });
});
