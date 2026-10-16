import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebChannelError } from '@/types/firefox/error';

import { useWebChannelService } from './WebChannelService';

const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/157.0 Mobile/15E148 Safari/604.1';

interface ISentMessage {
  command: string;
  data: unknown;
  messageId: string;
}

function captureMessages() {
  const details: unknown[] = [];

  const listener = (event: Event) => {
    details.push((event as CustomEvent).detail);
  };

  window.addEventListener('WebChannelMessageToChrome', listener);

  const sent = (): ISentMessage[] =>
    details.map(detail => {
      const parsed = (typeof detail === 'string' ? JSON.parse(detail) : detail) as { message: ISentMessage };

      return parsed.message;
    });

  return { details, sent, stop: () => window.removeEventListener('WebChannelMessageToChrome', listener) };
}

function reply(detail: unknown): void {
  window.dispatchEvent(new CustomEvent('WebChannelMessageToContent', { detail }));
}

describe('useWebChannelService', () => {
  let capture: ReturnType<typeof captureMessages>;

  beforeEach(() => {
    capture = captureMessages();
  });

  afterEach(() => {
    capture.stop();
    vi.restoreAllMocks();
  });

  it('sends a JSON string detail to desktop Firefox', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);

    const pending = useWebChannelService().canLinkAccount('ada@example.com', 'a'.repeat(32));
    const [message] = capture.sent();

    expect(typeof capture.details[0]).toBe('string');
    expect(message.command).toBe('fxaccounts:can_link_account');
    expect(message.messageId).toMatch(/^\d+$/);

    reply({ id: 'account_updates', message: { messageId: message.messageId, data: { ok: true } } });

    await expect(pending).resolves.toBe(true);
  });

  it('sends an object detail to Firefox for iOS and reads its string reply with a numeric messageId', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_UA);

    const pending = useWebChannelService().canLinkAccount('ada@example.com', 'a'.repeat(32));
    const [message] = capture.sent();

    expect(typeof capture.details[0]).toBe('object');

    reply(
      JSON.stringify({ id: 'account_updates', message: { messageId: Number(message.messageId), data: { ok: true } } })
    );

    await expect(pending).resolves.toBe(true);
  });

  it('ignores replies to other messages and other channels', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);

    const pending = useWebChannelService().canLinkAccount('ada@example.com', 'a'.repeat(32));
    const [message] = capture.sent();

    reply('not json');
    reply({ id: 'other_channel', message: { messageId: message.messageId, data: { ok: false } } });
    reply({ id: 'account_updates', message: { messageId: '1', data: { ok: false } } });
    reply({ id: 'account_updates', message: { messageId: message.messageId, data: { ok: true } } });

    await expect(pending).resolves.toBe(true);
  });

  it('rejects when Firefox answers with an error', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);

    const pending = useWebChannelService().canLinkAccount('ada@example.com', 'a'.repeat(32));
    const [message] = capture.sent();

    reply({
      id: 'account_updates',
      message: { messageId: message.messageId, data: { error: { message: 'Unrecognized command' } } },
    });

    await expect(pending).rejects.toThrow(WebChannelError);
  });

  it('sends login and oauth_login in order without waiting for a reply', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);
    const service = useWebChannelService();

    service.login({
      email: 'ada@example.com',
      uid: 'a'.repeat(32),
      sessionToken: 'b'.repeat(64),
      verified: true,
      services: { sync: {} },
    });
    service.oauthLogin({ action: 'signin', code: 'c'.repeat(64), state: 'state', redirect: 'urn:x', scope: 'profile' });

    expect(capture.sent().map(message => message.command)).toEqual(['fxaccounts:login', 'fxaccounts:oauth_login']);
  });
});
