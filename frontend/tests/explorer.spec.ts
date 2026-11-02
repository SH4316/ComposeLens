import { expect, test, type Page } from '@playwright/test';
import type { Finding, ImageReport } from '@composelens/shared';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const COMPOSE = 'services:\n  web:\n    image: nginx:latest\n  cache:\n    image: redis:7.4\n';
const COMPLETE_COVERAGE = '2개 중 2개 분석 제공';
const PARTIAL_COVERAGE = '2개 중 1개 분석 제공 · 1개 확인 필요';

test.use({ viewport: { width: 1440, height: 1000 } });

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

async function mockProjectFiles(page: Page, files: Record<string, string>, findingsByReference: Record<string, Finding[]>, entries: Record<string, unknown> = {}) {
  const requests = { images: [] as string[], files: [] as string[], repositories: 0 };
  await page.route('https://api.github.com/repos/example/stack**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const prefix = '/repos/example/stack/contents/';
    if (!pathname.startsWith(prefix)) {
      requests.repositories++;
      return route.fulfill({ json: { private: false, default_branch: 'main' } });
    }
    const path = decodeURIComponent(pathname.slice(prefix.length));
    requests.files.push(path);
    if (Object.hasOwn(entries, path)) return route.fulfill({ json: entries[path] });
    const content = files[path];
    return content === undefined
      ? route.fulfill({ status: 404, json: { message: 'Not Found' } })
      : route.fulfill({ json: {
        type: 'file', encoding: 'base64', size: Buffer.byteLength(content),
        content: Buffer.from(content).toString('base64'), sha: `test-sha:${path}`,
      } });
  });
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    requests.images.push(reference);
    return route.fulfill({ json: report(reference, findingsByReference[reference] ?? []) });
  });
  await page.route('**/api/tags?**', (route) => route.fulfill({ json: { tags: [], nextPage: null } }));
  return requests;
}

async function mockPinnedRepository(page: Page, repository: string, ref: string, files: Record<string, string>, entries: Record<string, unknown> = {}) {
  const requests: { path: string; ref: string | null }[] = [];
  await page.route('https://api.github.com/repos/' + repository + '**', (route) => {
    const url = new URL(route.request().url());
    const prefix = '/repos/' + repository + '/contents/';
    const path = url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : '(metadata)';
    requests.push({ path, ref: url.searchParams.get('ref') });
    if (url.searchParams.get('ref') !== ref) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    if (Object.hasOwn(entries, path)) return route.fulfill({ json: entries[path] });
    const content = files[path];
    return content === undefined
      ? route.fulfill({ status: 404, json: { message: 'Not Found' } })
      : route.fulfill({ json: {
        type: 'file', encoding: 'base64', size: Buffer.byteLength(content),
        content: Buffer.from(content).toString('base64'), sha: 'pinned-dockerfile-sha',
      } });
  });
  return requests;
}

async function analyze(page: Page, coverage = COMPLETE_COVERAGE, composePath = 'compose.yml') {
  await page.goto('/');
  await page.getByLabel('GitHub 저장소 URL').fill('https://github.com/example/stack');
  await page.getByLabel('Compose 파일 경로', { exact: true }).fill(composePath);
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await expect(page.locator('.analysis-status')).toHaveText(coverage);
}

function deferredResponse() {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
}

async function expectCounts(page: Page, images: number, vulnerabilities: number) {
  const headings = page.locator('.connection-headings .pane-heading');
  await expect(headings.first().locator('.count-badge')).toHaveText(String(images));
  await expect(headings.last().locator('.count-badge')).toHaveText(String(vulnerabilities));
}

test('scopes CVEs and details to an image while retaining the image inventory, then restores all images', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockSources(page);
  await analyze(page);

  await expectCounts(page, 2, 4);
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 4개 / 전체 4개');
  await expect(page.locator('.connection-lines')).toHaveAttribute('aria-label', '5개의 이미지·취약점 연결');
  await page.getByRole('button', { name: 'CVE-2025-0001 상세 보기', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('영향받는 이미지 2개', { exact: true })).toBeVisible();
  await expect(drawer.getByText('openssl', { exact: true })).toHaveCount(2);
  await expect(drawer.getByText('3.0.17', { exact: true })).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  const nginx = page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true });
  const redis = page.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true });
  await nginx.click();
  await expect(nginx).toHaveAttribute('aria-pressed', 'true');
  await expect(redis).toBeVisible();
  await expectCounts(page, 2, 3);
  await expect(page.locator('.inspection-summary')).toContainText('nginx:latest');
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 3개 / 전체 3개');
  await expect(page.locator('.connection-lines')).toHaveAttribute('aria-label', '3개의 이미지·취약점 연결');
  await expect.poll(() => page.locator('.connection-path.highlighted').count()).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/explorer-desktop.png', fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: 'CVE-2025-0001 상세 보기', exact: true }).click();
  await expect(drawer.getByText('영향받는 이미지 1개', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'nginx:latest', exact: true })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'redis:7.4', exact: true })).toHaveCount(0);
  await expect(drawer.getByText('openssl', { exact: true })).toHaveCount(1);
  await expect(drawer.getByText('3.0.17', { exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(nginx).toHaveAttribute('aria-pressed', 'true');
  await expectCounts(page, 2, 3);

  await redis.click();
  await expectCounts(page, 2, 2);
  await expect(page.locator('.inspection-summary')).toContainText('redis:7.4');
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 2개 / 전체 2개');
  await page.getByRole('button', { name: '전체 보기', exact: true }).click();
  await expectCounts(page, 2, 4);
  await expect(nginx).toHaveAttribute('aria-pressed', 'false');
  await expect(redis).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.inspection-summary')).toContainText('전체 이미지의 취약점');
  expect(errors).toEqual([]);
});

test('applies severity and search filters to the inventory while keeping the image scope on the right', async ({ page }) => {
  await mockSources(page);
  await analyze(page);
  await page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true }).click();
  await page.getByRole('button', { name: 'Critical', exact: true }).click();
  await expectCounts(page, 1, 1);
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 1개 / 전체 3개');
  await expect(page.getByRole('button', { name: 'CVE-2024-0002 상세 보기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expectCounts(page, 2, 3);

  const search = page.getByLabel('이미지·CVE·패키지 검색', { exact: true });
  await search.fill('openssl');
  await expectCounts(page, 2, 1);
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 1개 / 전체 3개');
  await expect(page.locator('.connection-lines')).toHaveAttribute('aria-label', '1개의 이미지·취약점 연결');
  await page.getByRole('button', { name: '전체 보기', exact: true }).click();
  await expectCounts(page, 2, 1);
  await expect(page.locator('.connection-lines')).toHaveAttribute('aria-label', '2개의 이미지·취약점 연결');
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 1개 / 전체 4개');
  await search.fill('no-matching-image-or-package');
  await expectCounts(page, 0, 0);
  await expect(page.getByText('일치하는 이미지가 없습니다', { exact: true })).toBeVisible();
  await expect(page.getByText('필터에 일치하는 취약점이 없습니다', { exact: true })).toBeVisible();
});

test('keeps the selected image scope when another version has a confirmed zero CVEs', async ({ page }) => {
  await mockSources(page);
  await analyze(page);
  const versionResponse = deferredResponse();
  await page.route('**/api/images?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('reference')?.includes('1.28.0')) await versionResponse.ready;
    await route.fallback();
  });
  await page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true }).click();
  const nginx = page.locator('.image-item').filter({ hasText: 'nginx' });
  await nginx.getByRole('button', { name: '버전 선택', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.tag-choice').filter({ hasText: '1.28.0' }).click();
  try {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toBeVisible();
    await expect(page.locator('.analysis-progress')).toHaveCount(0);
    await expect(nginx.getByText('이미지·취약점 조회 중', { exact: true })).toBeVisible();
  } finally {
    versionResponse.release();
  }
  await expect(page.getByRole('button', { name: 'library/nginx:1.28.0 이미지 관계 선택', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectCounts(page, 2, 0);
  await expect(page.locator('.inspection-summary')).toContainText('library/nginx:1.28.0');
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 0개 / 전체 0개');
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toBeVisible();
  await expect(nginx.getByText('조회 버전 변경', { exact: true })).toBeVisible();
  await expect(nginx.getByText('취약점 0건', { exact: true })).toBeVisible();
  await expect(page.locator('.image-item').filter({ hasText: 'redis:7.4' }).locator('.finding-count')).toContainText('2');

  await nginx.getByRole('button', { name: '버전 선택', exact: true }).click();
  await page.getByLabel('선택할 이미지 참조 또는 digest').fill(DIGEST);
  await page.getByRole('button', { name: '이 버전으로 조회', exact: true }).click();
  await expect(nginx.getByText('digest 고정', { exact: true })).toBeVisible();
  await expect(nginx.getByRole('button', { name: /이미지 관계 선택$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toBeVisible();
  await expectCounts(page, 2, 0);
  await page.getByRole('button', { name: '전체 보기', exact: true }).click();
  await expectCounts(page, 2, 2);
});

test('virtualizes large scoped results and preserves image scope and scroll when closing CVE details', async ({ page }) => {
  await mockSources(page, true);
  await analyze(page);
  const nginx = page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true });
  await nginx.click();
  await expectCounts(page, 2, 3003);
  expect(await page.locator('[data-vulnerability-id]').count()).toBeLessThan(30);
  await expect.poll(() => page.locator('.connection-path.highlighted').count()).toBeGreaterThan(0);
  const initialPath = await page.locator('.connection-path').first().getAttribute('d');
  const list = page.getByRole('region', { name: '취약점 목록', exact: true });
  await list.evaluate((element) => { element.scrollTop = 50_000; });
  await expect(page.getByRole('button', { name: 'CVE-2024-0002 상세 보기', exact: true })).toHaveCount(0);
  expect(await page.locator('[data-vulnerability-id]').count()).toBeLessThan(30);
  await expect.poll(() => page.locator('.connection-path').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.connection-path').first().getAttribute('d')).not.toBe(initialPath);

  const cve = await list.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll<HTMLElement>('[data-vulnerability-id]')).find((row) => {
      const bounds = row.getBoundingClientRect();
      return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
    })?.getAttribute('data-vulnerability-id');
  });
  expect(cve).toBeTruthy();
  const scrollBefore = await list.evaluate((element) => element.scrollTop);
  await page.getByRole('button', { name: `${cve} 상세 보기`, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('영향받는 이미지 1개', { exact: true })).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(nginx).toHaveAttribute('aria-pressed', 'true');
  await expectCounts(page, 2, 3003);
  await expect(page.locator('.inspection-summary')).toContainText('nginx:latest');
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  await expect(page.getByRole('button', { name: `${cve} 상세 보기`, exact: true })).toBeVisible();
});

test('immediately shows an image whose only CVE was at the end of a large global list and resets right scroll', async ({ page }) => {
  await mockSources(page, true);
  const tailCve = 'CVE-2099-99999';
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    return reference.includes('redis')
      ? route.fulfill({ json: report(reference, [finding(tailCve, 'LOW', 'redis-tail-package', null)]) })
      : route.fallback();
  });
  await analyze(page);
  await expectCounts(page, 2, 3004);
  const list = page.getByRole('region', { name: '취약점 목록', exact: true });
  await list.evaluate((element) => { element.scrollTop = 50_000; });
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(10_000);
  await expect(page.getByRole('button', { name: `${tailCve} 상세 보기`, exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 2, 1);
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 1개 / 전체 1개');
  await expect(page.getByRole('button', { name: `${tailCve} 상세 보기`, exact: true })).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.locator('.image-item').filter({ hasText: 'nginx:latest' }).locator('.finding-count')).toContainText('3003');
  await page.getByRole('button', { name: '전체 보기', exact: true }).click();
  await expectCounts(page, 2, 3004);
  await expect(page.locator('.inspection-summary')).toContainText('표시 CVE 3004개 / 전체 3004개');
  await expect(page.getByRole('button', { name: 'CVE-2024-0002 상세 보기', exact: true })).toBeVisible();
});

test('keeps the desktop inspection usable in light and dark themes without horizontal overflow', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mockSources(page);
  await analyze(page);
  await page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expectCounts(page, 2, 3);
  await page.screenshot({ path: 'test-results/explorer-light.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /테마: 시스템/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectCounts(page, 2, 3);
  await page.screenshot({ path: 'test-results/explorer-dark.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /테마: 다크/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('reports partial coverage and distinguishes selected missing analysis from a confirmed empty report', async ({ page }) => {
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
  await analyze(page, PARTIAL_COVERAGE);
  await expect(page.locator('.analysis-status')).toHaveText('2개 중 1개 분석 제공 · 1개 확인 필요');
  await expect(page.getByText('조회 완료', { exact: true })).toHaveCount(0);
  await expect(page.getByText('분석 정보 미제공', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 2, 0);
  await expect(page.locator('.inspection-summary')).toContainText('redis:7.4');
  await expect(page.locator('.inspection-summary')).toContainText('분석 정보 없음');
  await expect(page.getByText('표시할 취약점 정보가 없습니다', { exact: true })).toBeVisible();
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'nginx:latest 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 2, 0);
  await expect(page.locator('.inspection-summary')).toContainText('nginx:latest');
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toBeVisible();
  await expect(page.getByText('표시할 취약점 정보가 없습니다', { exact: true })).toHaveCount(0);
});

test('retains failed image metadata and selection while retrying only that image', async ({ page }) => {
  await mockSources(page);
  let redisRequests = 0;
  let nginxRequests = 0;
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    if (!reference.includes('redis')) {
      nginxRequests++;
      return route.fallback();
    }
    const result = report(reference, []);
    if (++redisRequests === 1) {
      result.status = 'unavailable';
      result.message = 'Docker Scout 응답 시간이 초과됐습니다.';
    }
    return route.fulfill({ json: result });
  });
  await analyze(page, PARTIAL_COVERAGE);
  const redis = page.locator('.image-item').filter({ hasText: 'redis:7.4' });
  await expect(redis.getByText('취약점 조회 실패', { exact: true })).toBeVisible();
  await expect(redis.locator('.digest')).toHaveAttribute('title', `현재 분석한 digest: ${DIGEST}`);
  await expect(redis.getByRole('button', { name: '버전 선택', exact: true })).toBeEnabled();
  await redis.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 2, 0);
  const retryResponse = deferredResponse();
  await page.route('**/api/images?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('reference')?.includes('redis')) await retryResponse.ready;
    await route.fallback();
  });
  await redis.getByRole('button', { name: '다시 조회', exact: true }).click();
  try {
    await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toBeVisible();
    await expect(page.locator('.analysis-progress')).toHaveCount(0);
    await expect(redis.getByText('이미지·취약점 조회 중', { exact: true })).toBeVisible();
  } finally {
    retryResponse.release();
  }
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expect(redis.getByText('취약점 조회 실패', { exact: true })).toHaveCount(0);
  await expect(redis.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.analysis-status')).toHaveText('2개 중 2개 분석 제공');
  await expectCounts(page, 2, 0);
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toBeVisible();
  expect(redisRequests).toBe(2);
  expect(nginxRequests).toBe(1);
});

test('shows only inputs initially and reveals help on focus or hover with Escape dismissal', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main');
  const footer = page.getByRole('contentinfo');
  await expect(main.getByRole('textbox')).toHaveCount(2);
  await expect(page.getByLabel('GitHub 저장소 URL')).toHaveValue('');
  await expect(page.getByLabel('Compose 파일 경로', { exact: true })).toHaveValue('compose.yml');
  await expect(main.getByRole('button', { name: '분석', exact: true })).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(main.getByRole('heading')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toHaveCount(0);
  await expect(page.locator('.analysis-progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예제로 살펴보기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(footer).toContainText('ComposeLens');
  await expect(footer.getByRole('button', { name: /테마: 시스템/ })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'ComposeLens GitHub 소스', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/explorer-input.png', fullPage: true, animations: 'disabled' });

  const inputHelp = page.getByRole('button', { name: '입력 도움말', exact: true });
  await inputHelp.focus();
  await expect(page.getByRole('tooltip')).toContainText('공개 GitHub 저장소의 기본 브랜치');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByLabel('GitHub 저장소 URL').focus();
  await inputHelp.hover();
  await expect(page.getByRole('tooltip')).toContainText('Docker Hub 이미지를 지원합니다.');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await footer.getByRole('button', { name: '데이터 안내', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('Docker Hub');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('shows progress until every image settles, then returns to inputs with drafts intact for a new analysis', async ({ page }) => {
  await mockSources(page);
  const fileResponse = deferredResponse();
  const nginxResponse = deferredResponse();
  const redisResponse = deferredResponse();
  let imageRequests = 0;
  await page.route('https://api.github.com/repos/example/stack/contents/**', async (route) => {
    await fileResponse.ready;
    await route.fallback();
  });
  await page.route('**/api/images?**', async (route) => {
    imageRequests++;
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    await (reference.includes('redis') ? redisResponse.ready : nginxResponse.ready);
    await route.fallback();
  });
  await page.goto('/');
  const repository = page.getByLabel('GitHub 저장소 URL');
  const path = page.getByLabel('Compose 파일 경로', { exact: true });
  const results = page.getByRole('region', { name: '분석 결과', exact: true });
  const progress = page.locator('.analysis-progress');
  await repository.fill('https://github.com/example/stack');
  await path.fill('compose.yml');
  await page.getByRole('button', { name: '분석', exact: true }).click();
  try {
    await expect(progress).toHaveAttribute('role', 'status');
    await expect(progress.getByRole('heading', { name: '분석 중', exact: true, level: 1 })).toBeVisible();
    await expect(progress.getByText('설정 읽는 중', { exact: true })).toBeVisible();
    await expect(repository).toHaveCount(0);
    await expect(path).toHaveCount(0);
    await expect(results).toHaveCount(0);

    fileResponse.release();
    await expect.poll(() => imageRequests).toBe(2);
    await expect(progress.getByText('0 / 2', { exact: true })).toBeVisible();
    await expect(results).toHaveCount(0);
    await page.screenshot({ path: 'test-results/explorer-progress.png', fullPage: true, animations: 'disabled' });
    nginxResponse.release();
    await expect(progress.getByText('1 / 2', { exact: true })).toBeVisible();
    await expect(results).toHaveCount(0);
    await expect(repository).toHaveCount(0);
  } finally {
    fileResponse.release();
    nginxResponse.release();
    redisResponse.release();
  }
  await expect(results).toBeVisible();
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expect(progress).toHaveCount(0);
  await expect(repository).toHaveCount(0);
  await expectCounts(page, 2, 4);
  await page.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true }).click();
  await page.getByRole('contentinfo').getByRole('button', { name: '다시 분석', exact: true }).click();
  await expect(repository).toHaveValue('https://github.com/example/stack');
  await expect(path).toHaveValue('compose.yml');
  await expect(results).toHaveCount(0);
  await expect(progress).toHaveCount(0);

  await path.fill('deploy/compose.override.yml');
  const nextFile = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/contents/deploy/compose.override.yml'));
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await nextFile;
  await expect(results).toBeVisible();
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expectCounts(page, 2, 4);
  await expect(page.locator('.inspection-summary')).toContainText('전체 이미지의 취약점');
  await page.getByRole('contentinfo').getByRole('button', { name: '다시 분석', exact: true }).click();
  await expect(repository).toHaveValue('https://github.com/example/stack');
  await expect(path).toHaveValue('deploy/compose.override.yml');
});

test('returns file errors to inputs with values intact and recovers after correcting the path', async ({ page }) => {
  await mockSources(page);
  await page.route('https://api.github.com/repos/example/stack/contents/missing.yml**', (route) => route.fulfill({
    status: 404, json: { message: 'Not Found' },
  }));
  await page.goto('/');
  const repository = page.getByLabel('GitHub 저장소 URL');
  const path = page.getByLabel('Compose 파일 경로', { exact: true });
  await repository.fill('https://github.com/example/stack');
  await path.fill('missing.yml');
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Compose 파일을 찾을 수 없습니다.');
  await expect(repository).toHaveValue('https://github.com/example/stack');
  await expect(path).toHaveValue('missing.yml');
  await expect(page.locator('.analysis-progress')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toHaveCount(0);

  await path.fill('compose.yml');
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toBeVisible();
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectCounts(page, 2, 4);
});

test('stores submitted analysis inputs in the URL, preserves unrelated URL state, and analyzes again on refresh', async ({ page }) => {
  await mockSources(page);
  const repository = 'https://github.com/example/stack';
  const composePath = 'deploy/compose.override.yml';
  await page.goto('/?campaign=desktop#workspace');
  await page.getByLabel('GitHub 저장소 URL').fill(repository);
  await page.getByLabel('Compose 파일 경로', { exact: true }).fill(composePath);
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  const submittedUrl = new URL(page.url());
  expect(submittedUrl.searchParams.get('url')).toBe(repository);
  expect(submittedUrl.searchParams.get('compose')).toBe(composePath);
  expect(submittedUrl.searchParams.get('campaign')).toBe('desktop');
  expect(submittedUrl.hash).toBe('#workspace');

  await page.getByRole('contentinfo').getByRole('button', { name: '다시 분석', exact: true }).click();
  await expect(page.getByLabel('GitHub 저장소 URL')).toHaveValue(repository);
  await expect(page.getByLabel('Compose 파일 경로', { exact: true })).toHaveValue(composePath);
  expect(page.url()).toBe(submittedUrl.href);
  await page.reload();
  await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toBeVisible();
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expect(page.locator('.results-source').getByRole('link', { name: composePath, exact: true })).toBeVisible();
  await expect(page.getByLabel('GitHub 저장소 URL')).toHaveCount(0);
  await expectCounts(page, 2, 4);
  expect(page.url()).toBe(submittedUrl.href);
});

test('automatically analyzes encoded shared inputs and defaults an omitted Compose path', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockSources(page);
  const fileResponse = deferredResponse();
  await page.route('https://api.github.com/repos/example/stack/contents/**', async (route) => {
    await fileResponse.ready;
    await route.fallback();
  });
  const repository = 'https://github.com/example/stack/?tab=readme&label=a+b';
  const composePath = 'deploy/production stack/compose+override.yml';
  const parameters = new URLSearchParams({ url: repository, compose: composePath, campaign: 'shared' });
  const fileRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/contents/deploy/production%20stack/compose%2Boverride.yml'));
  await page.goto('/?' + parameters.toString() + '#shared');
  try {
    await expect(page.locator('.analysis-progress').getByRole('heading', { name: '분석 중', exact: true })).toBeVisible();
    await expect(page.getByLabel('GitHub 저장소 URL')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toHaveCount(0);
  } finally {
    fileResponse.release();
  }
  expect(new URL((await fileRequest).url()).searchParams.get('ref')).toBe('main');
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expect(page.locator('.results-source').getByRole('heading', { name: 'example/stack', exact: true })).toBeVisible();
  await expect(page.locator('.results-source').getByRole('link', { name: composePath, exact: true })).toBeVisible();
  const sharedUrl = new URL(page.url());
  expect(sharedUrl.searchParams.get('url')).toBe(repository);
  expect(sharedUrl.searchParams.get('compose')).toBe(composePath);
  expect(sharedUrl.searchParams.get('campaign')).toBe('shared');
  expect(sharedUrl.hash).toBe('#shared');
  await page.getByRole('contentinfo').getByRole('button', { name: '다시 분석', exact: true }).click();
  await expect(page.getByLabel('GitHub 저장소 URL')).toHaveValue(repository);
  await expect(page.getByLabel('Compose 파일 경로', { exact: true })).toHaveValue(composePath);

  await page.goto('/?' + new URLSearchParams({ url: repository }).toString());
  await expect(page.locator('.analysis-status')).toHaveText(COMPLETE_COVERAGE);
  await expect(page.locator('.results-source').getByRole('link', { name: 'compose.yml', exact: true })).toBeVisible();
  await page.getByRole('contentinfo').getByRole('button', { name: '다시 분석', exact: true }).click();
  await expect(page.getByLabel('GitHub 저장소 URL')).toHaveValue(repository);
  await expect(page.getByLabel('Compose 파일 경로', { exact: true })).toHaveValue('compose.yml');
  expect(errors).toEqual([]);
});

test('resolves nested build Dockerfiles to runtime bases and preserves base provenance when changing versions', async ({ page }) => {
  const nginxRef = 'nginx:1.31.8-alpine-slim';
  const nodeRef = 'node:22-alpine';
  const runtimeCve = 'CVE-2026-10001';
  const backendCve = 'CVE-2026-10002';
  const alternateCve = 'CVE-2026-10003';
  const requests = await mockProjectFiles(page, {
    'deployment/compose.yml': [
      'services:',
      '  web:',
      '    image: composelens-web:local',
      '    build:',
      '      context: ..',
      '      dockerfile: frontend/Dockerfile',
      '      args:',
      '        NGINX_TAG: 1.31.8-alpine-slim',
      '  backend:',
      '    build:',
      '      context: ../backend',
      '      dockerfile: Dockerfile',
    ].join('\n'),
    'frontend/Dockerfile': [
      'ARG NGINX_TAG=stable-alpine',
      'FROM node:24-alpine AS builder',
      'RUN npm ci',
      'FROM nginx:${NGINX_TAG} AS runtime',
      'COPY --from=builder /app/dist /usr/share/nginx/html',
      'RUN apk add curl',
    ].join('\n'),
    'backend/Dockerfile': [
      'ARG NODE_TAG=22-alpine',
      'FROM node:${NODE_TAG} AS base',
      'WORKDIR /app',
      'FROM base AS runtime',
      'COPY . .',
    ].join('\n'),
  }, {
    [nginxRef]: [finding(runtimeCve, 'HIGH', 'nginx-runtime-package', '1.31.9')],
    [nodeRef]: [finding(backendCve, 'MEDIUM', 'backend-runtime-package', null)],
    'nginx:1.29-alpine': [finding(alternateCve, 'LOW', 'alternate-base-package', null)],
  });
  await analyze(page, COMPLETE_COVERAGE, 'deployment/compose.yml');
  await expectCounts(page, 2, 2);
  expect([...requests.images].sort()).toEqual([nginxRef, nodeRef].sort());
  expect([...requests.files].sort()).toEqual(['deployment/compose.yml', 'frontend/Dockerfile', 'backend/Dockerfile'].sort());
  expect(requests.repositories).toBe(1);
  const web = page.locator('.image-item').filter({ hasText: 'web' });
  const backend = page.locator('.image-item').filter({ hasText: 'backend' });
  await expect(web.getByText('베이스 기준', { exact: true })).toBeVisible();
  await expect(backend.getByText('베이스 기준', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: nodeRef + ' 이미지 관계 선택', exact: true })).toBeVisible();
  await web.getByRole('button', { name: nginxRef + ' 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 2, 1);
  await expect(page.getByRole('button', { name: runtimeCve + ' 상세 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: backendCve + ' 상세 보기', exact: true })).toHaveCount(0);
  const baseHelp = page.locator('.inspection-summary').getByRole('button', { name: '베이스 이미지 안내', exact: true });
  await baseHelp.focus();
  await expect(page.getByRole('tooltip')).toContainText('composelens-web:local');
  await expect(page.getByRole('tooltip')).toContainText('frontend/Dockerfile');
  await expect(page.getByRole('tooltip')).toContainText('RUN·COPY로 추가·삭제된 패키지는 반영하지 않습니다.');
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/explorer-build-base.png', fullPage: true, animations: 'disabled' });
  await page.getByLabel('이미지·CVE·패키지 검색', { exact: true }).focus();
  await baseHelp.hover();
  await expect(page.getByRole('tooltip')).toContainText('RUN·COPY로 추가·삭제된 패키지는 반영하지 않습니다.');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await web.getByRole('button', { name: '버전 선택', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Dockerfile 원본 베이스', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '베이스 이미지 안내', exact: true }).hover();
  await expect(page.getByRole('dialog').getByRole('tooltip')).toContainText('frontend/Dockerfile');
  await expect(page.getByRole('dialog').getByRole('tooltip')).toContainText('composelens-web:local');
  await page.mouse.move(0, 0);
  await page.getByLabel('선택할 이미지 참조 또는 digest').fill('nginx:1.29-alpine');
  await page.getByRole('button', { name: '이 버전으로 조회', exact: true }).click();
  await expect(page.getByRole('button', { name: alternateCve + ' 상세 보기', exact: true })).toBeVisible();
  await expect(web.getByText('베이스 기준', { exact: true })).toBeVisible();
  await expect(web.getByRole('button', { name: 'nginx:1.29-alpine 이미지 관계 선택', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(baseHelp).toBeVisible();

  await web.getByRole('button', { name: '버전 선택', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '원본 베이스로 돌아가기', exact: true }).click();
  await expect(page.getByRole('button', { name: runtimeCve + ' 상세 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: alternateCve + ' 상세 보기', exact: true })).toHaveCount(0);
  await expect(web.getByRole('button', { name: nginxRef + ' 이미지 관계 선택', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(web.getByText('베이스 기준', { exact: true })).toBeVisible();
  expect(requests.images).not.toContain('composelens-web:local');
  expect(requests.images).not.toContain('node:24-alpine');
});

test('uses the explicitly selected build target instead of the final Dockerfile stage', async ({ page }) => {
  const builderCve = 'CVE-2026-20001';
  const requests = await mockProjectFiles(page, {
    'compose.yml': [
      'services:',
      '  web:',
      '    image: composelens-web:local',
      '    build:',
      '      context: .',
      '      dockerfile: frontend/Dockerfile',
      '      target: builder',
    ].join('\n'),
    'frontend/Dockerfile': [
      'FROM node:24-alpine AS builder',
      'RUN npm ci',
      'FROM nginx:1.31.8-alpine-slim AS runtime',
      'COPY --from=builder /app/dist /usr/share/nginx/html',
    ].join('\n'),
  }, {
    'node:24-alpine': [finding(builderCve, 'CRITICAL', 'builder-only-package', null)],
    'nginx:1.31.8-alpine-slim': [finding('CVE-2026-20002', 'LOW', 'runtime-only-package', null)],
  });
  await analyze(page, '1개 중 1개 분석 제공');
  await expectCounts(page, 1, 1);
  expect(requests.images).toEqual(['node:24-alpine']);
  expect(requests.repositories).toBe(1);
  const image = page.locator('.image-item');
  await expect(image.getByText('베이스 기준', { exact: true })).toBeVisible();
  await image.getByRole('button', { name: 'node:24-alpine 이미지 관계 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: builderCve + ' 상세 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CVE-2026-20002 상세 보기', exact: true })).toHaveCount(0);
  await page.locator('.inspection-summary').getByRole('button', { name: '베이스 이미지 안내', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('builder');
});

test('keeps direct image findings when a Dockerfile is missing without claiming the build has zero vulnerabilities', async ({ page }) => {
  const redisCve = 'CVE-2026-30001';
  const requests = await mockProjectFiles(page, {
    'deployment/compose.yml': [
      'services:',
      '  web:',
      '    image: composelens-web:local',
      '    build:',
      '      context: ..',
      '      dockerfile: frontend/MissingDockerfile',
      '  cache:',
      '    image: redis:7.4',
    ].join('\n'),
  }, {
    'redis:7.4': [finding(redisCve, 'HIGH', 'redis-package', null)],
  });
  const missingFileResponse = deferredResponse();
  await page.route('https://api.github.com/repos/example/stack/contents/frontend/MissingDockerfile**', async (route) => {
    await missingFileResponse.ready;
    await route.fallback();
  });
  const missingFileRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/contents/frontend/MissingDockerfile'));
  await page.goto('/?' + new URLSearchParams({ url: 'https://github.com/example/stack', compose: 'deployment/compose.yml' }).toString());
  await missingFileRequest;
  try {
    await expect(page.locator('.analysis-progress').getByText('설정 읽는 중', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toHaveCount(0);
  } finally {
    missingFileResponse.release();
  }
  await expect(page.locator('.analysis-status')).toHaveText(PARTIAL_COVERAGE);
  await expectCounts(page, 2, 1);
  expect(requests.images).toEqual(['redis:7.4']);
  expect([...requests.files].sort()).toEqual(['deployment/compose.yml', 'frontend/MissingDockerfile', 'frontend'].sort());
  expect(requests.repositories).toBe(1);
  const unresolved = page.locator('.image-item').filter({ hasText: 'web' });
  await expect(unresolved.getByText('확인 필요', { exact: true })).toBeVisible();
  await expect(unresolved.getByText('취약점 0건', { exact: true })).toHaveCount(0);
  await expect(unresolved.getByText('베이스 기준', { exact: true })).toHaveCount(0);
  await unresolved.getByRole('button', { name: /이미지 관계 선택$/ }).click();
  await expectCounts(page, 2, 0);
  await expect(page.locator('.inspection-summary')).toContainText('분석 정보 없음');
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 2, 1);
  await expect(page.getByRole('button', { name: redisCve + ' 상세 보기', exact: true })).toBeVisible();
});

test('reads a submodule Dockerfile at its gitlink SHA and shows the pinned repository provenance', async ({ page }) => {
  const appSha = 'a'.repeat(40);
  const baseRef = 'nginx:1.31-alpine';
  const baseCve = 'CVE-2026-40001';
  const requests = await mockProjectFiles(page, {
    'deployment/compose.yml': [
      'services:',
      '  web:',
      '    image: local-web:dev',
      '    build:',
      '      context: ../vendor/app',
      '      dockerfile: docker/Dockerfile',
    ].join('\n'),
  }, {
    [baseRef]: [finding(baseCve, 'HIGH', 'submodule-nginx-package', '1.31.1')],
  }, {
    vendor: [{ type: 'file', name: 'app', path: 'vendor/app', sha: appSha }],
    'vendor/app': {
      type: 'file', name: 'app', path: 'vendor/app',
      submodule_git_url: 'git@github.com:example/app.git', sha: appSha,
    },
  });
  const appRequests = await mockPinnedRepository(page, 'example/app', appSha, {
    'docker/Dockerfile': 'FROM nginx:1.31-alpine AS runtime\n',
  });
  await analyze(page, '1개 중 1개 분석 제공', 'deployment/compose.yml');
  await expectCounts(page, 1, 1);
  expect(requests.images).toEqual([baseRef]);
  expect(requests.repositories).toBe(1);
  expect(requests.files).toEqual(expect.arrayContaining([
    'deployment/compose.yml', 'vendor/app/docker/Dockerfile', 'vendor', 'vendor/app',
  ]));
  expect(appRequests).toEqual([{ path: 'docker/Dockerfile', ref: appSha }]);
  const image = page.locator('.image-item');
  await expect(image.getByText('베이스 기준', { exact: true })).toBeVisible();
  await image.getByRole('button', { name: baseRef + ' 이미지 관계 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: baseCve + ' 상세 보기', exact: true })).toBeVisible();
  await page.locator('.inspection-summary').getByRole('button', { name: '베이스 이미지 안내', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('example/app@aaaaaaa · docker/Dockerfile');
  await expect(page.getByRole('tooltip')).toContainText('local-web:dev');
  const tooltip = await page.getByRole('tooltip').boundingBox();
  const workspace = await page.locator('.results-section').boundingBox();
  expect(tooltip!.x).toBeGreaterThanOrEqual(workspace!.x);
  expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(workspace!.x + workspace!.width);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/explorer-submodule.png', animations: 'disabled' });
});

test('follows nested pinned submodules while retaining results beside an inaccessible submodule', async ({ page }) => {
  const appSha = 'a'.repeat(40);
  const serverSha = 'b'.repeat(40);
  const privateSha = 'c'.repeat(40);
  const nodeRef = 'node:22-alpine';
  const nodeCve = 'CVE-2026-50001';
  const redisCve = 'CVE-2026-50002';
  const requests = await mockProjectFiles(page, {
    'deployment/compose.yml': [
      'services:',
      '  web:',
      '    image: local-nested:dev',
      '    build:',
      '      context: ../vendor/app',
      '      dockerfile: packages/server/docker/Dockerfile',
      '  blocked:',
      '    image: local-private:dev',
      '    build:',
      '      context: ../vendor/private',
      '  cache:',
      '    image: redis:7.4',
    ].join('\n'),
  }, {
    [nodeRef]: [finding(nodeCve, 'HIGH', 'nested-node-package', null)],
    'redis:7.4': [finding(redisCve, 'MEDIUM', 'direct-redis-package', null)],
  }, {
    vendor: [
      { type: 'file', name: 'app', path: 'vendor/app', sha: appSha },
      { type: 'file', name: 'private', path: 'vendor/private', sha: privateSha },
    ],
    'vendor/app': {
      type: 'file', name: 'app', path: 'vendor/app',
      submodule_git_url: 'https://github.com/example/app.git', sha: appSha,
    },
    'vendor/private': {
      type: 'file', name: 'private', path: 'vendor/private',
      submodule_git_url: 'https://github.com/example/private.git', sha: privateSha,
    },
  });
  const appRequests = await mockPinnedRepository(page, 'example/app', appSha, {}, {
    packages: [{ type: 'file', name: 'server', path: 'packages/server', sha: serverSha }],
    'packages/server': {
      type: 'file', name: 'server', path: 'packages/server',
      submodule_git_url: 'git@github.com:example/server.git', sha: serverSha,
    },
  });
  const serverRequests = await mockPinnedRepository(page, 'example/server', serverSha, {
    'docker/Dockerfile': 'FROM node:22-alpine AS runtime\n',
  });
  const privateRequests = await mockPinnedRepository(page, 'example/private', privateSha, {});
  await analyze(page, '3개 중 2개 분석 제공 · 1개 확인 필요', 'deployment/compose.yml');
  await expectCounts(page, 3, 2);
  expect([...requests.images].sort()).toEqual([nodeRef, 'redis:7.4'].sort());
  expect(requests.repositories).toBe(1);
  expect([...appRequests].sort((left, right) => left.path.localeCompare(right.path))).toEqual([
    { path: 'packages', ref: appSha },
    { path: 'packages/server', ref: appSha },
    { path: 'packages/server/docker/Dockerfile', ref: appSha },
  ]);
  expect(serverRequests).toEqual([{ path: 'docker/Dockerfile', ref: serverSha }]);
  expect(privateRequests).toEqual([{ path: 'Dockerfile', ref: privateSha }]);
  const blocked = page.locator('.image-item').filter({ hasText: 'blocked' });
  await expect(blocked.getByText('확인 필요', { exact: true })).toBeVisible();
  await expect(blocked.getByText('취약점 0건', { exact: true })).toHaveCount(0);
  await blocked.getByRole('button', { name: /이미지 관계 선택$/ }).click();
  await expectCounts(page, 3, 0);
  await expect(page.locator('.inspection-summary')).toContainText('분석 정보 없음');
  await expect(page.getByText('조회된 취약점이 없습니다', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'redis:7.4 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 3, 1);
  await expect(page.getByRole('button', { name: redisCve + ' 상세 보기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: nodeRef + ' 이미지 관계 선택', exact: true }).click();
  await expectCounts(page, 3, 1);
  await expect(page.getByRole('button', { name: nodeCve + ' 상세 보기', exact: true })).toBeVisible();
  await page.locator('.inspection-summary').getByRole('button', { name: '베이스 이미지 안내', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('example/server@bbbbbbb · docker/Dockerfile');
});
