import { type Page, test } from '@playwright/test';
import { resolve } from 'node:path';

import { SignInPage } from '../pages/SignInPage';
import { webRoute } from '../utils/urls';
import { TEST_PASSWORD } from '../utils/users';

const OUT_DIR = resolve(__dirname, '../../resources/screenshots');

// Getting started shows the instance's own address and, over HTTP, a warning; the shot shows a public HTTPS server.
const PUBLIC_URL = 'https://sync.example.com';

// Outlasts the 150 ms colour transitions on the selected tab and hovered rows.
const SETTLE_MS = 500;

const shoot = async (page: Page, name: string): Promise<void> => {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
};

const open = async (page: Page, path: string): Promise<void> => {
  await page.goto(webRoute(path));
  await page.waitForLoadState('networkidle');
};

test('README screenshots', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('isDarkMode', 'true'));
  await new SignInPage(page).signIn({ email: 'alex@example.com', password: TEST_PASSWORD });

  await open(page, '/getting-started');
  await page.getByRole('radio', { name: 'Android', exact: true }).click();
  await page.getByTestId('android-server-url').evaluate((element, url) => {
    element.textContent = url;
  }, PUBLIC_URL);
  await page.getByTestId('mobile-needs-https').evaluateAll(elements => elements.forEach(element => element.remove()));
  await shoot(page, 'getting-started');

  await open(page, '/devices');
  await shoot(page, 'devices');

  await open(page, '/admin/users');
  await shoot(page, 'users');

  await open(page, '/admin/invites');
  await shoot(page, 'invites');
});
