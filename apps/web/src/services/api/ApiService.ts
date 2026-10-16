import axios from 'axios';
import type { z } from 'zod';

import { isErrorResponse, isValidationResponse } from '@libs/dto';

import { RequestStatus, RequestType } from '@/types/api';
import { ApiError, ApiErrorBase, ApiValidationError } from '@/types/api/error';

import { Config } from '@/Config';

import { useLogService } from '@/services/LogService';

const logService = useLogService();
const logger = logService.createLogger('services/api/ApiService');

interface IRequestOptions {
  token?: string | null;
  form?: string | null;
  body?: unknown;
  timeoutMs?: number;
}

interface IParsedRequestOptions<Schema extends z.ZodType> extends IRequestOptions {
  response: Schema;
}

export const useApiService = () => {
  function makeRequest<Schema extends z.ZodType>(
    endpoint: string,
    type: RequestType,
    requestOptions: IParsedRequestOptions<Schema>
  ): Promise<z.output<Schema>>;
  function makeRequest(endpoint: string, type: RequestType, requestOptions?: IRequestOptions): Promise<void>;
  function makeRequest(
    endpoint: string,
    type: RequestType,
    requestOptions?: IRequestOptions & { response?: z.ZodType }
  ): Promise<unknown> {
    const headers: { [key: string]: string } = {
      'Content-Type': 'application/json',
    };

    if (requestOptions?.token) {
      headers.Authorization = `Bearer ${requestOptions.token}`;
    }

    return axios
      .request<unknown>({
        url: `${Config.API_BASE_URL}${endpoint}`,
        method: type,
        headers,
        timeout: requestOptions?.timeoutMs ?? Config.API_TIMEOUT_MS,
        data: JSON.stringify(requestOptions?.body),
        validateStatus: () => true,
      })
      .catch((error: unknown) => {
        logger.error({ error, method: type, endpoint }, 'makeRequest(): Handling axios error');

        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ECONNABORTED') {
          throw new ApiError(ApiErrorBase.TIMEOUT);
        }

        if (typeof error === 'object' && error !== null && 'message' in error && error.message === 'Network Error') {
          throw new ApiError(ApiErrorBase.NETWORK);
        }

        throw new ApiError(ApiErrorBase.UNKNOWN);
      })
      .then(response => {
        if (
          response.status === RequestStatus.SUCCESS ||
          response.status === RequestStatus.CREATED ||
          response.status === RequestStatus.ACCEPTED
        ) {
          if (requestOptions?.response === undefined) {
            return undefined;
          }

          const parsed = requestOptions.response.safeParse(response.data);

          if (!parsed.success) {
            logger.error({ issues: parsed.error.issues, method: type, endpoint }, 'makeRequest(): Unexpected response');

            throw new ApiError(ApiErrorBase.UNKNOWN);
          }

          return parsed.data;
        }

        let errorMessage: string | undefined;

        if (isErrorResponse(response.data)) {
          errorMessage = response.data.message;
        }

        switch (response.status) {
          case RequestStatus.UNAUTHORIZED:
            throw new ApiError(ApiErrorBase.UNAUTHORIZED, errorMessage);
          // The api explains a 403, such as the default password still awaiting a change.
          case RequestStatus.FORBIDDEN:
            throw new ApiError(ApiErrorBase.FORBIDDEN, errorMessage);
          case RequestStatus.NOT_FOUND:
            throw new ApiError(ApiErrorBase.NOT_FOUND);
          case RequestStatus.TOO_MANY_REQUESTS:
            throw new ApiError(ApiErrorBase.TOO_MANY_REQUESTS);
        }

        if (errorMessage !== undefined) {
          throw new ApiError(ApiErrorBase.UNKNOWN, errorMessage);
        }

        if (isValidationResponse(response.data)) {
          const validationFields: { [key: string]: { name?: string; message: string } } = {};

          for (const validationError of response.data.message) {
            validationFields[validationError.path] = {
              name: validationError.name,
              message: validationError.message,
            };
          }

          throw new ApiValidationError(requestOptions?.form ?? null, validationFields);
        }

        throw new ApiError(ApiErrorBase.UNKNOWN);
      });
  }

  return {
    makeRequest,
  };
};
