import { bytesToHex, createClientSalt, createSignUpKeys, stretchPasswordV2 } from '@libs/fxa-crypto';

export interface IClientSignUp {
  authPw: string;
  wrapKb: string;
  clientSalt: string;
}

/**
 * The browser's half of a v2 sign-up (`FxaAuthClient.signUp`), for an account the server creates itself: a fresh
 * client salt, the stretched authPW and a random kB wrapped with the password. kB itself is not kept.
 */
export async function clientSignUp(password: string): Promise<IClientSignUp> {
  const clientSalt = createClientSalt();
  const stretched = await stretchPasswordV2(password, clientSalt);
  const { wrapKb } = createSignUpKeys(stretched.unwrapBKey);

  return { authPw: bytesToHex(stretched.authPW), wrapKb: bytesToHex(wrapKb), clientSalt };
}
