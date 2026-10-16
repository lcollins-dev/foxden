import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';
import { usePasswordResetService } from './PasswordResetService';

vi.mock('./ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

vi.mock('@libs/fxa-crypto', () => ({
  createPasswordCredentials: vi.fn().mockResolvedValue({ authPw: 'a'.repeat(64), clientSalt: 'salt' }),
}));

describe('usePasswordResetService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn().mockResolvedValue({ sessionToken: 'e'.repeat(64) });
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });
    clearValidationErrorMock = vi.fn();

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
      clearValidationError: clearValidationErrorMock,
    } as unknown as ReturnType<typeof useErrorService>);
  });

  it("resets the password and answers the new session's token seed", async () => {
    await expect(usePasswordResetService().resetPassword('b'.repeat(64), 'a new password')).resolves.toBe(
      'e'.repeat(64)
    );

    expect(makeRequestMock).toHaveBeenCalledWith('password-reset', RequestType.POST, {
      response: ResetPasswordResponseDto,
      body: { token: 'b'.repeat(64), authPw: 'a'.repeat(64), clientSalt: 'salt' },
    });
    expect(clearValidationErrorMock).toHaveBeenCalled();
  });

  it('hands a refusal to the error service', async () => {
    const refusal = new Error("This reset link doesn't work any more.");
    makeRequestMock.mockRejectedValue(refusal);

    await expect(usePasswordResetService().resetPassword('b'.repeat(64), 'a new password')).rejects.toThrow(refusal);

    expect(handleErrorMock).toHaveBeenCalledWith(refusal);
  });
});
