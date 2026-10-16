import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ITokenRequest, TokenExchangeService } from './token-exchange.service';
import { AccessTokenVerificationService } from '@/core/tokenserver/access-token-verification.service';
import { TokenserverService } from '@/core/tokenserver/tokenserver.service';

import { TokenserverError, tokenserverErrorFor } from './tokenserver-error';
import { TokenserverRefusedError } from '@/core/tokenserver/tokenserver-refusal';

const FXA_UID = '319b98f9961ff1dbdd07313cd6ba925a';

const tokenRequest = (fields: Partial<ITokenRequest> = {}): ITokenRequest => ({
  application: 'sync',
  version: '1.5',
  authorization: 'Bearer token',
  keyId: '1700000000000-aulGg1ccenxU2rRwCqOZXw',
  clientState: undefined,
  duration: undefined,
  ...fields,
});

describe('TokenExchangeService', () => {
  let verify: ReturnType<typeof vi.fn>;
  let issueToken: ReturnType<typeof vi.fn>;
  let service: TokenExchangeService;

  beforeEach(() => {
    verify = vi.fn().mockResolvedValue({ fxaUid: FXA_UID, generation: null });
    issueToken = vi.fn().mockResolvedValue({
      id: 'id',
      key: 'key',
      uid: 42,
      node: 'https://sync.example.com/storage',
      hashedFxaUid: '049bbd59065e40fdc5e544d25e42599d',
    });

    service = new TokenExchangeService(
      { verify } as unknown as AccessTokenVerificationService,
      { issueToken } as unknown as TokenserverService
    );
  });

  const failureOf = async (request: ITokenRequest): Promise<string> => {
    try {
      await service.exchange(request);
    } catch (error) {
      const tokenserverError = error instanceof TokenserverRefusedError ? tokenserverErrorFor(error.refusal) : error;

      if (tokenserverError instanceof TokenserverError) {
        return `${tokenserverError.httpStatus} ${tokenserverError.status} ${tokenserverError.description}`;
      }

      throw error;
    }

    return 'ok';
  };

  it('answers in the tokenserver`s shape, with the storage endpoint for the uid', async () => {
    await expect(service.exchange(tokenRequest())).resolves.toEqual({
      id: 'id',
      key: 'key',
      uid: 42,
      api_endpoint: 'https://sync.example.com/storage/1.5/42',
      duration: 3600,
      hashed_fxa_uid: '049bbd59065e40fdc5e544d25e42599d',
      hashalg: 'sha256',
      node_type: 'sqlite',
    });

    expect(issueToken).toHaveBeenCalledWith(
      { fxaUid: FXA_UID, generation: null },
      { keysChangedAt: 1700000000000, clientState: '6ae94683571c7a7c54dab4700aa3995f' },
      3600
    );
  });

  it.each([
    ['60', 60],
    ['7200', 3600],
    ['soon', 3600],
  ])('takes duration=%s as %i seconds', async (duration, expected) => {
    expect((await service.exchange(tokenRequest({ duration }))).duration).toBe(expected);
  });

  it.each([
    [{ authorization: undefined }, '401 error Unauthorized'],
    [{ authorization: 'Bearertoken' }, '401 error Unauthorized'],
    [{ authorization: 'Basic token' }, '401 error Unsupported'],
    [{ keyId: undefined }, '401 invalid-key-id Missing X-KeyID header'],
    [{ application: 'bookmarks' }, '404 error Unsupported application'],
    [{ version: '1.0' }, '404 error Unsupported application version'],
  ])('rejects %o', async (fields, expected) => {
    expect(await failureOf(tokenRequest(fields))).toBe(expected);
  });

  it('verifies the access token before reading X-KeyID, so a bad token wins', async () => {
    verify.mockRejectedValue(new TokenserverRefusedError({ reason: 'invalid-credentials' }));

    expect(await failureOf(tokenRequest({ keyId: undefined }))).toBe('401 invalid-credentials Unauthorized');
  });

  it('accepts the scheme in any case', async () => {
    expect(await failureOf(tokenRequest({ authorization: 'BEARER token' }))).toBe('ok');
    expect(verify).toHaveBeenCalledWith('token');
  });
});
