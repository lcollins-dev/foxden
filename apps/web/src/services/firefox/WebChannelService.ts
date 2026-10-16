/**
 * The FxA WebChannel (ff/toolkit/actors/WebChannelChild.sys.mjs, FxAccountsWebChannel.sys.mjs). Firefox only
 * answers pages on the origin of `identity.fxaccounts.remote.root`, and handles one message at a time in order.
 * Firefox for Android and iOS speak it too (android-components FxaWebChannelFeature.kt, firefox-ios
 * FxAWebViewModel.swift), with the differences fxa-settings/src/lib/channels/firefox.ts allows for.
 */
import type { IFxaLoginData, IFxaOAuthLoginData, IFxaStatus } from '@/types/firefox';
import { WebChannelError, WebChannelTimeoutError } from '@/types/firefox/error';

import { isFirefoxForIos } from '@/utils/userAgent';

const CHANNEL_ID = 'account_updates';

/** Firefox's reply when this origin is not its FxA root (WebChannelParent.sys.mjs ERRNO_NO_SUCH_CHANNEL). */
const ERRNO_NO_SUCH_CHANNEL = 2;

/** fxa-settings/src/lib/hooks/useFxAStatus: three tries of one second each. */
const FXA_STATUS_ATTEMPTS = 3;
const FXA_STATUS_TIMEOUT_MS = 1000;

type TJson = Record<string, unknown>;

const isRecord = (value: unknown): value is TJson => typeof value === 'object' && value !== null;

/** Digits only and a safe integer: Firefox for iOS drops a message whose id is not an integer, and echoes it as a number. */
let lastMessageId = Date.now();

function nextMessageId(): string {
  lastMessageId += 1;

  return String(lastMessageId);
}

/**
 * Firefox for iOS reads `detail` only as an object; desktop accepts only a string, and so does Android's
 * WebChannel extension. fxa-settings tells them apart by the same user agent test (`formatEventDetail`).
 */
function dispatchToFirefox(command: string, data: unknown, messageId: string): void {
  const detail = { id: CHANNEL_ID, message: { command, data, messageId } };

  window.dispatchEvent(
    new CustomEvent('WebChannelMessageToChrome', { detail: isFirefoxForIos() ? detail : JSON.stringify(detail) })
  );
}

/** Desktop answers with an object, Android and iOS with a JSON string. */
function readReplyDetail(event: Event): TJson | null {
  const detail: unknown = 'detail' in event ? event.detail : null;

  if (typeof detail !== 'string') {
    return isRecord(detail) ? detail : null;
  }

  try {
    const parsed: unknown = JSON.parse(detail);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const useWebChannelService = () => {
  function request(command: string, data: unknown, timeoutMs?: number): Promise<TJson> {
    const messageId = nextMessageId();

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        window.removeEventListener('WebChannelMessageToContent', onMessage);
        clearTimeout(timer);
      };

      const onMessage = (event: Event) => {
        const detail = readReplyDetail(event);

        if (detail === null || detail.id !== CHANNEL_ID || !isRecord(detail.message)) {
          return;
        }

        const message = detail.message;

        if (message.errno === ERRNO_NO_SUCH_CHANNEL) {
          finish();
          reject(new WebChannelError('Firefox is not set up to sign in to this server.'));
          return;
        }

        if (String(message.messageId) !== messageId) {
          return;
        }

        finish();

        const reply = isRecord(message.data) ? message.data : {};

        if (isRecord(reply.error)) {
          reject(new WebChannelError(`Firefox reported an error: ${String(reply.error.message)}`));
          return;
        }

        resolve(reply);
      };

      window.addEventListener('WebChannelMessageToContent', onMessage);

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          finish();
          reject(new WebChannelTimeoutError(`Firefox did not answer ${command}`));
        }, timeoutMs);
      }

      dispatchToFirefox(command, data, messageId);
    });
  }

  /** Neither Firefox for Android nor iOS answers `login` or `oauth_login`. */
  function send(command: string, data: unknown): void {
    dispatchToFirefox(command, data, nextMessageId());
  }

  /** Resolves null when nothing answers, which means the page is not open in a Firefox pointed at this server. */
  async function fetchStatus(context: string): Promise<IFxaStatus | null> {
    for (let attempt = 0; attempt < FXA_STATUS_ATTEMPTS; attempt++) {
      try {
        const reply = await request(
          'fxaccounts:fxa_status',
          { service: 'sync', isPairing: false, context },
          FXA_STATUS_TIMEOUT_MS
        );

        const user = reply.signedInUser;
        const capabilities = isRecord(reply.capabilities) ? reply.capabilities : {};
        const engines = Array.isArray(capabilities.engines) ? capabilities.engines.map(String) : [];

        return {
          signedInUser:
            isRecord(user) && typeof user.email === 'string' && typeof user.uid === 'string'
              ? { email: user.email, uid: user.uid }
              : null,
          engines,
        };
      } catch (error) {
        if (!(error instanceof WebChannelTimeoutError)) {
          throw error;
        }
      }
    }

    return null;
  }

  /** Firefox may show a merge warning here; false means the user cancelled. */
  async function canLinkAccount(email: string, uid: string): Promise<boolean> {
    const reply = await request('fxaccounts:can_link_account', { email, uid });

    return reply.ok === true;
  }

  /** Sent without waiting, as fxa-settings does; desktop handles it before the `oauthLogin` that follows. */
  function login(data: IFxaLoginData): void {
    send('fxaccounts:login', data);
  }

  function oauthLogin(data: IFxaOAuthLoginData): void {
    send('fxaccounts:oauth_login', data);
  }

  return { fetchStatus, canLinkAccount, login, oauthLogin };
};
