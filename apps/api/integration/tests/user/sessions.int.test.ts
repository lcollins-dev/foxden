import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { AccountSessionDto, SessionListResponseDto } from '@libs/dto';

import { deleteSession, getProfile, listSessions, login, signOutOtherSessions } from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

describe('The signed-in account sessions (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  const registerDevice = (token: string, name: string) =>
    request(app.getHttpServer())
      .post('/auth/v1/account/device')
      .set(authHeaders(token))
      .send({ name, type: 'mobile' })
      .expect(200);

  const sessionList = async (token: string): Promise<AccountSessionDto[]> =>
    ((await listSessions(app, token).expect(200)).body as SessionListResponseDto).sessionList;

  const signedInTwice = async (): Promise<{ user: ITestUser; web: string; firefox: string }> => {
    const user = await createTestUser(app);
    const firefox = await login(app, user.email);
    const web = await login(app, user.email);

    return { user, web, firefox };
  };

  describe('listing', () => {
    it('lists every session of the account newest first, with its device, marking the calling one', async () => {
      const { web, firefox } = await signedInTwice();
      await registerDevice(firefox, "Sam's Firefox");

      const sessions = await sessionList(web);

      expect(sessions).toEqual([
        {
          id: expect.any(Number),
          device: null,
          userAgent: null,
          createdAt: expect.any(String),
          lastAccessAt: expect.any(String),
          current: true,
        },
        {
          id: expect.any(Number),
          device: { name: "Sam's Firefox", type: 'mobile' },
          userAgent: null,
          createdAt: expect.any(String),
          lastAccessAt: expect.any(String),
          current: false,
        },
      ]);
    });

    it('leaves out the sessions of other accounts', async () => {
      const { web } = await signedInTwice();
      const other = await createTestUser(app);
      await login(app, other.email);

      expect(await sessionList(web)).toHaveLength(2);
    });

    it('is refused without a session', async () => {
      await request(app.getHttpServer()).get('/api/v1/user/session/list').expect(401);
    });

    it('is refused to an account held to first-time setup', async () => {
      const { user, web } = await signedInTwice();
      await dbQuery(app, 'UPDATE "user" SET "mustChangePassword" = 1 WHERE id = ?', [user.id]);

      const [session] = await dbQuery<{ id: number }>(app, 'SELECT id FROM session WHERE "userId" = ?', [user.id]);

      await listSessions(app, web).expect(403);
      await signOutOtherSessions(app, web).expect(403);
      await deleteSession(app, web, session.id).expect(403);
    });
  });

  describe('signing out one session', () => {
    it('ends the session and its device', async () => {
      const { user, web, firefox } = await signedInTwice();
      await registerDevice(firefox, 'Doomed Firefox');
      const [, firefoxSession] = await sessionList(web);

      await deleteSession(app, web, firefoxSession.id).expect(200);

      await request(app.getHttpServer()).get('/auth/v1/session/status').set(authHeaders(firefox)).expect(401);
      await getProfile(app, web).expect(200);

      const devices = await dbQuery(app, 'SELECT id FROM device WHERE "userId" = ?', [user.id]);
      expect(devices).toHaveLength(0);
    });

    it('answers 404 for a session of another account and leaves it alone', async () => {
      const { web } = await signedInTwice();
      const other = await signedInTwice();
      const [otherSession] = await sessionList(other.web);

      await deleteSession(app, web, otherSession.id).expect(404);

      await getProfile(app, other.web).expect(200);
    });
  });

  describe('signing out every other session', () => {
    it('ends every session but the calling one and counts them', async () => {
      const { user, web, firefox } = await signedInTwice();
      const another = await login(app, user.email);

      const response = await signOutOtherSessions(app, web).expect(200);

      expect(response.body).toEqual({ signedOut: 2 });
      await getProfile(app, web).expect(200);
      await getProfile(app, firefox).expect(401);
      await getProfile(app, another).expect(401);
      expect(await sessionList(web)).toHaveLength(1);
    });
  });
});
