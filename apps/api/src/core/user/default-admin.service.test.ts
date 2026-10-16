import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ADMIN, UserRoleId } from '@libs/dto';

import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { DefaultAdminService } from '@/core/user/default-admin.service';
import { UserService } from '@/core/user/user.service';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

describe('DefaultAdminService', () => {
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let userUserRoles: Record<string, ReturnType<typeof vi.fn>>;
  let updateRoles: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let service: DefaultAdminService;

  beforeEach(() => {
    users = { count: vi.fn().mockResolvedValue(0), insert: vi.fn(), find: vi.fn().mockResolvedValue([]) };
    userUserRoles = { count: vi.fn().mockResolvedValue(0) };
    updateRoles = vi.fn();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service = new DefaultAdminService(
      { updateRoles } as unknown as UserService,
      users as unknown as Repository<User>,
      userUserRoles as unknown as Repository<UserUserRole>
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the default admin with both admin roles, held to first-time setup, while no admin exists', async () => {
    await service.onApplicationBootstrap();

    expect(userUserRoles.count).toHaveBeenCalledWith({ where: { userRoleId: UserRoleId.USER_ADMIN } });

    const inserted = users.insert.mock.calls[0][0] as User;
    expect(inserted).toMatchObject({
      email: DEFAULT_ADMIN.email,
      normalizedEmail: DEFAULT_ADMIN.email,
      mustChangePassword: true,
      enabled: true,
    });
    expect(inserted.clientSalt).toMatch(/^identity\.mozilla\.com\/picl\/v1\/quickStretchV2:[0-9a-f]{32}$/);
    expect(inserted.verifyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(updateRoles).toHaveBeenCalledWith([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], inserted.id);
  });

  it('creates nothing once an admin exists', async () => {
    userUserRoles.count.mockResolvedValue(1);

    await service.onApplicationBootstrap();

    expect(users.insert).not.toHaveBeenCalled();
  });

  it('creates nothing and logs an error when another account holds the default address', async () => {
    users.count.mockResolvedValue(1);

    await service.onApplicationBootstrap();

    expect(users.insert).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('warns on every start while an account still has the default password', async () => {
    userUserRoles.count.mockResolvedValue(1);
    users.find.mockResolvedValue([{ email: DEFAULT_ADMIN.email }]);

    await service.onApplicationBootstrap();

    expect(users.find).toHaveBeenCalledWith({ where: { mustChangePassword: true } });
    expect(warn).toHaveBeenCalledWith(
      { email: DEFAULT_ADMIN.email },
      expect.stringContaining('still has the default password') as string
    );
  });
});
