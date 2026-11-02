import { expect, test, type Page } from '@playwright/test';
import type { Finding, ImageReport } from '@composelens/shared';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const COMPOSE = 'services:\n  web:\n    image: nginx:latest\n  cache:\n    image: redis:7.4\n';

function finding(cve: string, severity: Finding['severity'], packageName: string, fixedVersion: string | null): Finding {
  return {
    id: `${packageName}:${cve}`, cve, packageName, packageVersion: '3.0.16',
    purl: `pkg:deb/debian/${packageName}@3.0.16`, severity,
    score: 7.5, fixedVersion, description: 'Test advisory description.',
    source: 'debian', url: `https://scout.docker.com/v/${cve}`,
  };
}

function report(reference: string, findings: Finding[]): ImageReport {
  return {
    status: 'available', retrievedAt: '2026-11-02T04:00:00Z', findings,
    metadata: {
      repository: reference.includes('redis') ? 'library/redis' : 'library/nginx',
      reference, tag: 'latest', digest: DIGEST, platform: 'linux/amd64',
      size: 60_000_000, updatedAt: '2026-10-28T04:00:00Z', sourceUrl: 'https://hub.docker.com/_/nginx',
    },
  };
}

async function mockSources(page: Page, many = false) {
  await page.route('https://api.github.com/repos/example/stack**', (route) => {
    const file = new URL(route.request().url()).pathname.includes('/contents/');
    return route.fulfill({ json: file
      ? { type: 'file', encoding: 'base64', size: COMPOSE.length, content: Buffer.from(COMPOSE).toString('base64'), sha: 'test-file-sha' }
      : { private: false, default_branch: 'main' } });
  });
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    let findings = reference.includes('redis')
      ? [finding('CVE-2025-0001', 'HIGH', 'openssl', '3.0.17'), finding('CVE-2022-0004', 'LOW', 'expat', null)]
      : [finding('CVE-2024-0002', 'CRITICAL', 'zlib', null), finding('CVE-2025-0001', 'HIGH', 'openssl', '3.0.17'), finding('CVE-2023-0003', 'MEDIUM', 'curl', '8.1.0')];
    if (reference.includes('1.28.0') || reference.includes('@')) findings = [];
    if (many && reference.startsWith('nginx')) findings.push(...Array.from({ length: 3000 }, (_, index) => finding(`CVE-2020-${String(index + 10).padStart(5, '0')}`, 'LOW', 'test-package', null)));
    return route.fulfill({ json: report(reference, findings) });
  });
  await page.route('**/api/tags?**', (route) => route.fulfill({ json: {
    tags: [{ name: '1.28.0', digest: DIGEST, updatedAt: '2026-10-28T04:00:00Z' }], nextPage: null,
  } }));
}

async function analyze(page: Page) {
  await page.goto('/');
  await page.getByLabel('GitHub 저장소 URL').fill('https://github.com/example/stack');
  await page.getByLabel('Compose 파일 경로', { exact: true }).fill('compose.yml');
  await page.getByRole('button', { name: '연결 분석', exact: true }).click();
  await expect(page.getByText('조회 완료', { exact: true })).toBeVisible();
}

test('joins CVEs, highlights relationships, filters both lists, and opens package details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockSources(page);
  await analyze(page);

  await expect(page.locator('[data-image-id]')).toHaveCount(2);
  await expect(page.locator('[data-vulnerability-id]')).toHaveCount(4);
  await expect(page.locator('.connection-path')).toHaveCount(5);
  await expect(page.locator('.connection-path.uncertain')).toHaveCount(5);
  await page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택' }).click();
  await expect(page.locator('.connection-path.highlighted')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/explorer-desktop.png', fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: 'CVE-2025-0001 상세 보기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('openssl', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('dialog').getByText('3.0.17', { exact: true })).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Critical', exact: true }).click();
  await expect(page.locator('[data-image-id]')).toHaveCount(1);
  await expect(page.locator('[data-vulnerability-id]')).toHaveCount(1);
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByLabel('이미지·CVE·패키지 검색', { exact: true }).fill('openssl');
  await expect(page.locator('[data-image-id]')).toHaveCount(2);
  await expect(page.locator('[data-vulnerability-id]')).toHaveCount(1);
  await expect(page.locator('.connection-path')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('selects another image version without carrying over old findings', async ({ page }) => {
  await mockSources(page);
  await analyze(page);
  await page.locator('.image-item').first().getByRole('button', { name: '버전 선택' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.tag-choice').filter({ hasText: '1.28.0' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'library/nginx:1.28.0 이미지 관계 선택' })).toBeVisible();
  await expect(page.locator('[data-vulnerability-id]')).toHaveCount(2);
  await expect(page.getByText('다른 버전', { exact: true })).toBeVisible();

  await page.locator('.image-item').first().getByRole('button', { name: '버전 선택' }).click();
  await page.getByLabel('선택할 이미지 참조 또는 digest').fill(DIGEST);
  await page.getByRole('button', { name: '이 버전으로 조회', exact: true }).click();
  await expect(page.getByText('digest 고정', { exact: true })).toBeVisible();
});

test('virtualizes large result sets and preserves arrow positions while scrolling', async ({ page }) => {
  await mockSources(page, true);
  await analyze(page);
  await expect(page.locator('[data-vulnerability-id]').first()).toBeVisible();
  expect(await page.locator('[data-vulnerability-id]').count()).toBeLessThan(30);
  await page.getByRole('region', { name: '취약점 목록', exact: true }).evaluate((element) => { element.scrollTop = 50_000; });
  await expect(page.getByRole('button', { name: 'CVE-2024-0002 상세 보기' })).toHaveCount(0);
  expect(await page.locator('[data-vulnerability-id]').count()).toBeLessThan(30);
  await expect.poll(() => page.locator('.connection-path').count()).toBeGreaterThan(0);
});

test('supports narrow screens and light/dark themes without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSources(page);
  await analyze(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/explorer-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /테마: 시스템/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/explorer-dark.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /테마: 다크/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('distinguishes unavailable analysis from a confirmed empty report', async ({ page }) => {
  await mockSources(page);
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    const result = report(reference, []);
    if (reference.includes('redis')) {
      result.status = 'not-indexed';
      result.message = '공개 취약점 분석이 아직 제공되지 않습니다.';
    }
    return route.fulfill({ json: result });
  });
  await analyze(page);
  await expect(page.getByText('분석 정보 미제공', { exact: true })).toBeVisible();
  await expect(page.getByText('1/2개 이미지 분석 정보 제공 · 1개 확인 필요', { exact: true })).toBeVisible();
  await page.getByLabel('이미지·CVE·패키지 검색', { exact: true }).fill('redis');
  await expect(page.getByText('표시할 취약점 정보가 없습니다', { exact: true })).toBeVisible();
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toHaveCount(0);
});

test('retains image metadata when analysis fails and retries only that image', async ({ page }) => {
  await mockSources(page);
  let redisRequests = 0;
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    if (!reference.includes('redis')) return route.fallback();
    const result = report(reference, []);
    if (++redisRequests === 1) {
      result.status = 'unavailable';
      result.message = 'Docker Scout 응답 시간이 초과됐습니다.';
    }
    return route.fulfill({ json: result });
  });
  await analyze(page);
  const redis = page.locator('.image-item').filter({ hasText: 'redis:7.4' });
  await expect(redis.getByText('취약점 조회 실패', { exact: true })).toBeVisible();
  await expect(redis.locator('.digest')).toHaveAttribute('title', DIGEST);
  await expect(redis.getByRole('button', { name: '버전 선택' })).toBeEnabled();
  await redis.getByRole('button', { name: '다시 조회' }).click();
  await expect(redis.getByText('취약점 조회 실패', { exact: true })).toHaveCount(0);
  await expect(page.getByText('2/2개 이미지 분석 정보 제공', { exact: false })).toBeVisible();
  expect(redisRequests).toBe(2);
});
