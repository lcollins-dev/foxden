import { By, Key, until, type WebDriver } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';

import { openSyncSignIn } from './firefox.ts';

const UI_TIMEOUT_MS = 30_000;

async function typeInto(driver: WebDriver, selector: string, text: string, submit = false): Promise<void> {
  const input = await driver.wait(until.elementLocated(By.css(selector)), UI_TIMEOUT_MS);
  await driver.wait(until.elementIsEnabled(input), UI_TIMEOUT_MS);
  // clear() empties the DOM value without an input event, so Vue keeps a prefilled value such as the reauth email.
  await input.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE);
  await input.sendKeys(text, ...(submit ? [Key.ENTER] : []));
}

async function waitForTestId(driver: WebDriver, testId: string): Promise<void> {
  await driver.wait(until.elementLocated(By.css(`[data-testid="${testId}"]`)), UI_TIMEOUT_MS);
}

/** Opens an invite link in the current tab and creates the account through our invite page. */
export async function acceptInvite(driver: WebDriver, link: string, password: string): Promise<void> {
  await driver.get(link);

  await typeInto(driver, 'input[name="password"]', password);
  await typeInto(driver, 'input[name="confirm-password"]', password, true);

  await waitForTestId(driver, 'connect-firefox');
}

/** Presses Sign in as the avatar menu does and completes our Firefox sign-in page. */
export async function signInToSync(driver: Driver, email: string, password: string): Promise<void> {
  await openSyncSignIn(driver);

  await typeInto(driver, 'input[name="email"]', email, true);
  await typeInto(driver, 'input[name="password"]', password, true);

  try {
    await waitForTestId(driver, 'firefox-signed-in');
  } catch (error) {
    const errors = await driver.findElements(By.css('[data-testid="field-error"]'));
    const message = errors.length > 0 ? await errors[0].getText() : 'no error shown';

    throw new Error(`The sign-in page did not finish: ${message}`, { cause: error });
  }
}
