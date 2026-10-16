import { type APIRequestContext, expect } from '@playwright/test';

import type { CreateInviteResponseDto, UserListResponseDto } from '@libs/dto';

import { adminHeaders } from '../utils/auth';
import { BASE_URL } from '../utils/urls';

export const createInvite = async (
  request: APIRequestContext,
  email: string,
  name = 'E2E User',
  admin = false
): Promise<CreateInviteResponseDto> => {
  const response = await request.post(`${BASE_URL}/api/v1/admin/invite`, {
    headers: adminHeaders(),
    data: { email, name, admin },
  });

  expect(response.status()).toBe(201);

  return (await response.json()) as CreateInviteResponseDto;
};

export const findUserId = async (request: APIRequestContext, email: string): Promise<number> => {
  const response = await request.patch(`${BASE_URL}/api/v1/admin/user/list?page=1`, {
    headers: adminHeaders(),
    data: { search: email, status: 'all' },
  });

  expect(response.status()).toBe(200);

  const body = (await response.json()) as UserListResponseDto;
  const user = body.userList.find(entry => entry.email === email);

  if (user === undefined) {
    throw new Error(`No user ${email} in the admin list`);
  }

  return user.id;
};

export const updateUser = async (
  request: APIRequestContext,
  userId: number,
  update: { name: string; email: string; userRoleIds: number[] }
): Promise<void> => {
  const response = await request.patch(`${BASE_URL}/api/v1/admin/user/${userId}`, {
    headers: adminHeaders(),
    data: update,
  });

  expect(response.status()).toBe(200);
};

export const getBatchJobEnabled = async (request: APIRequestContext, batchJobId: number): Promise<boolean> => {
  const response = await request.get(`${BASE_URL}/api/v1/admin/batch-job/${batchJobId}`, { headers: adminHeaders() });

  expect(response.status()).toBe(200);

  const body = (await response.json()) as { enabled: boolean };

  return body.enabled;
};

export const setBatchJobEnabled = async (
  request: APIRequestContext,
  batchJobId: number,
  enabled: boolean
): Promise<void> => {
  const response = await request.patch(`${BASE_URL}/api/v1/admin/batch-job/${batchJobId}/state`, {
    headers: adminHeaders(),
    data: { enabled },
  });

  expect(response.status()).toBe(200);
};
