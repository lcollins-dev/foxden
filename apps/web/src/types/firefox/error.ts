import { AppError } from '@/types/error';

export class WebChannelError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'WebChannelError';
  }
}

export class WebChannelTimeoutError extends WebChannelError {}
