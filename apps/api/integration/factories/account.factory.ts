import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { UserRoleId } from '@libs/dto';
import { bytesToHex, createClientSalt, createSignUpKeys, stretchPasswordV2 } from '@libs/fxa-crypto';

import { createInvite, login } from '../clients/user.client';
import { dbQuery } from '../utils/db';
import { createTestUser } from './user.factory';

export interface ISignedUpAccount {
  id: number;
  uid: string;
  email: string;
  password: string;
  clientSalt: string;
  kB: Uint8Array<ArrayBuffer>;
  sessionToken: string;
  inviteToken: string;
}

/** Signs up through an invite with real v2 credentials, as the invite page does. */
export const signUpAccount = async (
  app: NestExpressApplication,
  password: string,
  name = 'Int Account'
): Promise<ISignedUpAccount> => {
  const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
  const adminToken = await login(app, admin.email);

  const email = `int-account-${randomUUID()}@foxden.test`;
  const invite = await createInvite(app, adminToken, { email, name, admin: false }).expect(201);
  const inviteToken = String(invite.body.link).split('/').pop() ?? '';

  const clientSalt = createClientSalt();
  const stretched = await stretchPasswordV2(password, clientSalt);
  const { kB, wrapKb } = createSignUpKeys(stretched.unwrapBKey);

  const created = await request(app.getHttpServer())
    .post('/auth/v1/account/create')
    .send({
      email,
      authPWVersion2: bytesToHex(stretched.authPW),
      wrapKbVersion2: bytesToHex(wrapKb),
      clientSalt,
      inviteToken,
    })
    .expect(200);

  const [user] = await dbQuery<{ id: number }>(app, 'SELECT id FROM "user" WHERE uid = ?', [created.body.uid]);

  return {
    id: user.id,
    uid: created.body.uid,
    email,
    password,
    clientSalt,
    kB,
    sessionToken: created.body.sessionToken,
    inviteToken,
  };
};
