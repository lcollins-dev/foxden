import { CheckInviteResponseDto, type CheckInviteRequestDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useApiService } from './ApiService';

export const useInviteService = () => {
  const apiService = useApiService();

  function checkInvite(token: string): Promise<CheckInviteResponseDto> {
    const request: CheckInviteRequestDto = { token };

    return apiService.makeRequest('invite/check', RequestType.POST, {
      response: CheckInviteResponseDto,
      body: request,
    });
  }

  return { checkInvite };
};
