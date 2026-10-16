import { describe, expect, it } from 'vitest';

import { UserListRequestDto, UserListRole, UserListStatus } from './admin';

describe('UserListRequestDto', () => {
  it('keeps a search term', () => {
    expect(UserListRequestDto.parse({ search: 'tester', status: UserListStatus.ALL }).search).toBe('tester');
  });

  it('reads an empty search as no search', () => {
    expect(UserListRequestDto.parse({ search: '', status: UserListStatus.ALL }).search).toBeUndefined();
  });

  it('leaves an absent search and role absent', () => {
    expect(UserListRequestDto.parse({ status: UserListStatus.ALL })).toEqual({ status: UserListStatus.ALL });
  });

  it('keeps a role', () => {
    expect(UserListRequestDto.parse({ status: UserListStatus.ALL, role: UserListRole.ADMIN }).role).toBe(
      UserListRole.ADMIN
    );
  });
});
