import { ServerInfoResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';

let serverInfo: Promise<ServerInfoResponseDto> | null = null;

export const useServerService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  /** Asked once per page load: the public URL and the invite lifetime only change with a restart. */
  function getServerInfo(): Promise<ServerInfoResponseDto> {
    serverInfo ??= apiService
      .makeRequest('server', RequestType.GET, { response: ServerInfoResponseDto })
      .catch((error: unknown) => {
        serverInfo = null;

        return errorService.handleError(error);
      });

    return serverInfo;
  }

  return { getServerInfo };
};
