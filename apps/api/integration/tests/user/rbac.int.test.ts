import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { getUserStats, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';

const ADMIN_ROUTE = '/api/v1/admin/user/stats';

describe('Admin route RBAC (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  it('rejects an unauthenticated request to an admin-only route', async () => {
    await request(app.getHttpServer()).get(ADMIN_ROUTE).expect(401);
  });

  it('rejects a user lacking the USER_ADMIN role', async () => {
    const user = await createTestUser(app);
    const token = await login(app, user.email);

    const response = await getUserStats(app, token).expect(401);

    expect(response.body.message).toBe('You are not allowed to do this');
  });

  it('allows a user holding the USER_ADMIN role', async () => {
    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    const token = await login(app, admin.email);

    const response = await getUserStats(app, token).expect(200);

    expect(response.body).toHaveProperty('total');
  });
});
