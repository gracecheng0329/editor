import { test, expect } from '@playwright/test';

test('OAuth cancellation offers a retry and ignores an external return location', async ({ page }) => {
  await page.goto('/auth/callback?error=access_denied&next=https%3A%2F%2Fevil.example');
  await expect(page).toHaveURL(/\/\?auth=failed/);
  await expect(page.getByText('登入未完成')).toBeVisible();
  await expect(page.getByRole('link', { name: '重新登入' })).toBeVisible();
});

test('logout rejects a cross-origin request', async ({ request }) => {
  const response = await request.post('/auth/logout', { headers: { Origin: 'https://evil.example' }, maxRedirects: 0 });
  expect(response.status()).toBe(403);
});

test('an invalid callback code displays a retry state', async ({ page }) => {
  await page.goto('/auth/callback?code=invalid&next=%2Fdocuments');
  await expect(page).toHaveURL(/\/\?auth=failed/);
  await expect(page.getByRole('link', { name: '重新登入' })).toBeVisible();
});
