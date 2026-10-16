import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const checkInvite = (app: NestExpressApplication, token: string | undefined) =>
  request(app.getHttpServer()).post('/api/v1/invite/check').send({ token });

export const listInvites = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/invite/list').set(authHeaders(token));

export const revokeInvite = (app: NestExpressApplication, token: string, inviteId: number | string) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/invite/${inviteId}`).set(authHeaders(token));

export const inviteToken = (link: unknown): string => String(link).split('/').pop() ?? '';
