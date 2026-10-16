import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVER_PATH_PREFIXES } from '@libs/dto';

import { bootstrapApp } from '../../setup';

const INDEX_HTML = '<!doctype html><title>web app index</title>';
const ASSET_JS = 'console.log("asset");';

// WEB_ROOT_PATH is read once when the app is built, so this file owns its app.
describe('Web app serving (integration, serial)', () => {
  let app: NestExpressApplication;
  let webRoot: string;

  beforeAll(async () => {
    webRoot = mkdtempSync(join(tmpdir(), 'foxden-web-'));
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'index.html'), INDEX_HTML);
    writeFileSync(join(webRoot, 'assets', 'app.js'), ASSET_JS);

    process.env.WEB_ROOT_PATH = webRoot;

    app = await bootstrapApp();
  });

  afterAll(() => {
    rmSync(webRoot, { recursive: true, force: true });
  });

  it('serves index.html at the root', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.text).toBe(INDEX_HTML);
  });

  it('serves a built asset as itself', async () => {
    const response = await request(app.getHttpServer()).get('/assets/app.js').expect(200);

    expect(response.text).toBe(ASSET_JS);
  });

  it('falls back to index.html for a path the api does not reserve', async () => {
    for (const path of ['/sign-in', '/admin/users/12', '/tokens', '/storage-info']) {
      const response = await request(app.getHttpServer()).get(path).expect(200);

      expect(response.text).toBe(INDEX_HTML);
    }
  });

  it('answers an unknown path under every reserved prefix with a json 404', async () => {
    for (const prefix of SERVER_PATH_PREFIXES) {
      for (const path of [prefix, `${prefix}/`, `${prefix}/does-not-exist`, `${prefix}/does-not-exist?query=1`]) {
        const response = await request(app.getHttpServer()).get(path).expect(404);

        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body.statusCode).toBe(404);
      }
    }
  });

  it('still routes a reserved path the api answers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/availability').expect(200);

    expect(response.body).toEqual({ available: true });
  });

  it('answers a non-GET request for an unknown path with a 404', async () => {
    await request(app.getHttpServer()).post('/sign-in').expect(404);
  });

  it('sends the web app a strict policy that still loads over plain HTTP, and keeps its links out of the Referer', async () => {
    for (const path of ['/', '/invite/0123', '/assets/app.js']) {
      const { headers } = await request(app.getHttpServer()).get(path).expect(200);

      expect(headers['content-security-policy']).toContain("script-src 'self'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
      expect(headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cache-control']).not.toBe('no-store');
    }
  });

  it('keeps the responses of the management API, the accounts servers and the tokenserver out of every cache', async () => {
    for (const path of ['/api/v1/availability', '/.well-known/fxa-client-configuration', '/token/1.0/sync/1.5']) {
      const { headers } = await request(app.getHttpServer()).get(path);

      expect(headers['cache-control']).toBe('no-store');
    }
  });
});
