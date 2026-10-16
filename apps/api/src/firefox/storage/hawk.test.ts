import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  HAWK_SKEW_SECONDS,
  hawkMac,
  hawkNormalizedString,
  IHawkRequest,
  parseHawkHeader,
  verifyHawkRequest,
} from './hawk';
import { deriveSigningSecret } from '@/core/tokenserver/sync-token';

// Vector A: syncstorage-rs `syncserver/src/web/auth.rs` test fixture.
const MASTER_SECRET = 'Ted Koppel is a robot';
const SECRETS = { masterSecret: MASTER_SECRET, signingSecret: deriveSigningSecret(MASTER_SECRET) };
const FIXTURE_ID =
  'eyJ1aWQiOiAxLCAibm9kZSI6ICJodHRwOi8vbG9jYWxob3N0OjUwMDAiLCAiZXhwaXJlcyI6IDE4ODQ5Njg0MzkuMCwgImZ4YV91aWQiOiAiMzE5Yjk4Zjk5NjFmZjFkYmRkMDczMTNjZDZiYTkyNWEiLCAiZnhhX2tpZCI6ICJkZTY5N2FkNjZkODQ1YjI4NzNjOWQ3ZTEzYjg5NzFhZiIsICJoYXNoZWRfZnhhX3VpZCI6ICIwZThkZjVkNDEzOThhMzg5OTEzYmQ4NDAyNDM1NjQ5NTE4YWY0NjQ5M2RhMWQ0YTQzN2E0NmRjMTc4NGM1MDFhIiwgImhhc2hlZF9kZXZpY2VfaWQiOiAiMmJjYjkyZjRkNDY5OGMzZDdiMDgzYTNjNjk4YTE2Y2NkNzhiYzJhOGQyMGE5NmU0YmIxMjhkZGNlYWY0ZTBiNiIsICJzYWx0IjogIjJiMzA3YiJ9lXaC5pIOenf7qL1AWlgKFvYH63nakyniTXP-7acS5cw=';
const FIXTURE_KEY = 'dSi3EoZyHwgDp-O9OG1jRHtmbGl2M1bwcWsi04C4F58=';
const FIXTURE_TS = 1569608439;
const FIXTURE_EXPIRES = 1884968439;

const A1 = {
  method: 'GET',
  resource: '/storage/1.5/1/storage/col2',
  nonce: 'h1Ch4vo=',
  mac: 'UwDpC+DSrHCSTQSfMOWlueB6kM6gHb0Hsv8eU9ZcTVs=',
};
const A2 = {
  method: 'POST',
  resource: '/storage/1.5/1/storage/col2?batch=MTUzNjE5ODk3NjkyMQ==&commit=true',
  nonce: '4Rj7c+0=',
  mac: 'E7j1UjN7//mh7pYXsgGi3n0KGR+sUPpuyogDVzJWaHg=',
};

const fixtureHeader = (nonce: string, mac: string, ts = FIXTURE_TS, id = FIXTURE_ID): string =>
  `Hawk id="${id}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;

const fixtureRequest = (overrides: Partial<IHawkRequest> = {}): IHawkRequest => ({
  authorization: fixtureHeader(A1.nonce, A1.mac),
  method: A1.method,
  resource: A1.resource,
  host: 'localhost',
  port: 5000,
  nowMs: FIXTURE_TS * 1000,
  expiryGraceSeconds: 0,
  ...overrides,
});

describe('hawk', () => {
  describe('MAC', () => {
    it.each([A1, A2])('matches the syncstorage-rs fixture for $method $resource', vector => {
      const normalized = hawkNormalizedString({
        ts: FIXTURE_TS,
        nonce: vector.nonce,
        method: vector.method,
        resource: vector.resource,
        host: 'localhost',
        port: 5000,
      });

      expect(hawkMac(FIXTURE_KEY, normalized).toString('base64')).toBe(vector.mac);
    });

    // Vector B: the Hawk specification's example (hapi hawk README, rust-hawk tests).
    const SPEC_KEY = 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn';
    const specFields = {
      ts: 1353832234,
      nonce: 'j4h3g2',
      resource: '/resource/1?b=1&a=2',
      host: 'example.com',
      port: 8000,
      ext: 'some-app-ext-data',
    };

    it('matches the Hawk specification example with ext', () => {
      const normalized = hawkNormalizedString({ ...specFields, method: 'GET' });

      expect(hawkMac(SPEC_KEY, normalized).toString('base64')).toBe('6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE=');
    });

    it('matches the Hawk specification example with a payload hash', () => {
      const hash = createHash('sha256').update('hawk.1.payload\ntext/plain\nThank you for flying Hawk\n').digest();

      expect(hash.toString('base64')).toBe('Yi9LfIIFRtBEPt74PVmbTF/xVAwPn7ub15ePICfgnuY=');
      expect(hawkMac(SPEC_KEY, hawkNormalizedString({ ...specFields, method: 'POST', hash })).toString('base64')).toBe(
        'aSe1DERmZuRl3pI36/9BdZmnErTw3sNzOOAUlfeKjVw='
      );
    });

    it('builds the normalized string of a Sync storage request', () => {
      expect(
        hawkNormalizedString({
          ts: 1700000100,
          nonce: 'dGVzdG5vbmNl',
          method: 'GET',
          resource: '/1.5/1/info/collections?v=1.161.0',
          host: 'sync.example.com',
          port: 443,
        })
      ).toBe(
        'hawk.1.header\n1700000100\ndGVzdG5vbmNl\nGET\n/1.5/1/info/collections?v=1.161.0\nsync.example.com\n443\n\n\n'
      );
    });
  });

  describe('parseHawkHeader', () => {
    it('reads the attributes Firefox sends', () => {
      expect(parseHawkHeader('Hawk id="abc", ts="1700000000", nonce="bm9uY2U=", mac="AAAA"')).toEqual({
        id: 'abc',
        ts: 1700000000,
        nonce: 'bm9uY2U=',
        mac: Buffer.from([0, 0, 0]),
      });
    });

    it('tolerates spacing and stray commas and lets a repeat overwrite', () => {
      expect(parseHawkHeader('Hawk ,id = "a" ,, ts="1",nonce="n",id="b"')).toMatchObject({ id: 'b', ts: 1 });
    });

    it.each([
      ['a missing prefix', 'id="a", ts="1", nonce="n", mac="AAAA"'],
      ['a lowercase prefix', 'hawk id="a"'],
      ['an unknown attribute', 'Hawk id="a", color="red"'],
      ['an unquoted value', 'Hawk id=a'],
      ['an unterminated value', 'Hawk id="a'],
      ['a missing equals sign', 'Hawk id'],
      ['a non-numeric ts', 'Hawk ts="soon"'],
      ['a mac that is not strict base64', 'Hawk mac="AAA"'],
    ])('rejects %s', (_case, header) => {
      expect(parseHawkHeader(header)).toBeNull();
    });
  });

  describe('verifyHawkRequest', () => {
    it('accepts the fixture request', () => {
      expect(verifyHawkRequest(fixtureRequest(), SECRETS)).toMatchObject({ uid: 1, salt: '2b307b' });
      expect(
        verifyHawkRequest(
          fixtureRequest({ authorization: fixtureHeader(A2.nonce, A2.mac), method: 'POST', resource: A2.resource }),
          SECRETS
        )
      ).not.toBeNull();
    });

    const otherId = Buffer.from(FIXTURE_ID, 'base64url');
    otherId[otherId.length - 1] ^= 1;

    it.each<[string, Partial<IHawkRequest>]>([
      ['another method', { method: 'POST' }],
      ['another path', { resource: `${A1.resource}?batch=MTUzNjE5ODk3NjkyMQ==&commit=true` }],
      ['another host', { host: 'other.example' }],
      ['another port', { port: 5001 }],
      ['another ts', { authorization: fixtureHeader(A1.nonce, A1.mac, 1536198978) }],
      ['another nonce', { authorization: fixtureHeader('1d4mRs0=', A1.mac) }],
      ['another mac', { authorization: fixtureHeader(A1.nonce, A2.mac) }],
      [
        'a changed token signature',
        { authorization: fixtureHeader(A1.nonce, A1.mac, FIXTURE_TS, otherId.toString('base64url')) },
      ],
      ['no Hawk prefix', { authorization: `Bearer ${FIXTURE_ID}` }],
      ['no Authorization header', { authorization: undefined }],
      ['an expiry equal to now', { nowMs: FIXTURE_EXPIRES * 1000, authorization: fixtureHeader(A1.nonce, A1.mac) }],
    ])('rejects %s', (_case, overrides) => {
      expect(verifyHawkRequest(fixtureRequest(overrides), SECRETS)).toBeNull();
    });

    it('rejects the fixture under another master secret', () => {
      expect(
        verifyHawkRequest(fixtureRequest(), { masterSecret: 'wibble', signingSecret: deriveSigningSecret('wibble') })
      ).toBeNull();
    });

    it('accepts an expired token only within the grace it is given, as for info/collections', () => {
      const expiredAt = (nowSeconds: number) => {
        const normalized = hawkNormalizedString({ ...A1, ts: nowSeconds, host: 'localhost', port: 5000 });
        const mac = hawkMac(FIXTURE_KEY, normalized).toString('base64');

        return { nowMs: nowSeconds * 1000, authorization: fixtureHeader(A1.nonce, mac, nowSeconds) };
      };

      expect(verifyHawkRequest(fixtureRequest(expiredAt(FIXTURE_EXPIRES + 10)), SECRETS)).toBeNull();
      expect(
        verifyHawkRequest(fixtureRequest({ ...expiredAt(FIXTURE_EXPIRES + 10), expiryGraceSeconds: 3600 }), SECRETS)
      ).toMatchObject({ uid: 1 });
      expect(
        verifyHawkRequest(fixtureRequest({ ...expiredAt(FIXTURE_EXPIRES + 3600), expiryGraceSeconds: 3600 }), SECRETS)
      ).toBeNull();
    });

    it("accepts the header of a request signed with a token in this server's format", () => {
      const id =
        'eyJub2RlIjoiaHR0cHM6Ly9zeW5jLmV4YW1wbGUuY29tIiwiZnhhX2tpZCI6IjE3MDAwMDAwMDAwMDAtYXVsR2cxY2NlbnhVMnJSd0NxT1pYdyIsImZ4YV91aWQiOiIzMTliOThmOTk2MWZmMWRiZGQwNzMxM2NkNmJhOTI1YSIsImhhc2hlZF9kZXZpY2VfaWQiOiJlOThiNmNhN2MzYTk4MGMxMTgxNDU0YmM1Y2QwYWY3MSIsImhhc2hlZF9meGFfdWlkIjoiMDQ5YmJkNTkwNjVlNDBmZGM1ZTU0NGQyNWU0MjU5OWQiLCJleHBpcmVzIjoxOTAwMDAwMDAwLCJ1aWQiOjEsInRva2Vuc2VydmVyX29yaWdpbiI6InJ1c3QiLCJzYWx0IjoiYTFiMmMzIn1EZ48r8bTpRZRh6TBBrjwXDsdVqD0-PE6TtTYrkEVWyw==';

      expect(
        verifyHawkRequest(
          {
            authorization: `Hawk id="${id}", ts="1700000100", nonce="dGVzdG5vbmNl", mac="T3Efr8VioOZRiAwQrEZ5M5OB17pJHPIVBRH/GhCAUuo="`,
            method: 'GET',
            resource: '/1.5/1/info/collections?v=1.161.0',
            host: 'sync.example.com',
            port: 443,
            nowMs: 1700000100000,
            expiryGraceSeconds: 0,
          },
          SECRETS
        )
      ).toEqual({ uid: 1, expires: 1900000000, node: 'https://sync.example.com', salt: 'a1b2c3' });
    });

    it('allows 52 weeks of clock skew and no more', () => {
      const withinSkew = { nowMs: (FIXTURE_TS + HAWK_SKEW_SECONDS) * 1000 };
      const beyondSkew = { nowMs: (FIXTURE_TS + HAWK_SKEW_SECONDS + 1) * 1000 };

      expect(verifyHawkRequest(fixtureRequest(withinSkew), SECRETS)).not.toBeNull();
      expect(verifyHawkRequest(fixtureRequest(beyondSkew), SECRETS)).toBeNull();
    });
  });
});
