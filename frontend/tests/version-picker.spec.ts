import { expect, test, type Page } from '@playwright/test';
import type { HistoricalImage, ImageReport } from '@composelens/shared';

const CURRENT = `sha256:${'a'.repeat(64)}`;
const PREVIOUS = `sha256:${'b'.repeat(64)}`;
const OLDER = `sha256:${'c'.repeat(64)}`;
const observation = (digest = PREVIOUS, version = '3.11.17'): HistoricalImage => ({
  sourceReference: 'library/python:3.11', digest, indexDigest: `sha256:${'1'.repeat(64)}`,
  platform: 'linux/amd64', recordedAt: '2026-10-27T08:54:27Z', version,
  sourceUrl: `https://github.com/docker-library/repo-info/blob/${'a'.repeat(40)}/repos/python/remote/3.11.md`,
});

test.use({ viewport: { width: 1440, height: 1000 } });

async function mockVersionSources(page: Page) {
  const requests = { tags: [] as URL[], history: [] as URL[], images: [] as string[] };
  const compose = 'services:\n  app:\n    image: python:3.11\n';
  await page.route('https://api.github.com/repos/example/stack**', (route) => route.fulfill({ json:
    new URL(route.request().url()).pathname.includes('/contents/')
      ? { type: 'file', encoding: 'base64', size: compose.length, content: Buffer.from(compose).toString('base64'), sha: 'test-file' }
      : { private: false, default_branch: 'main' },
  }));
  await page.route('**/api/images?**', (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference')!;
    requests.images.push(reference);
    const report: ImageReport = { status: 'available', findings: [], retrievedAt: '2026-11-02T00:00:00Z', metadata: {
      repository: 'library/python', reference, tag: reference.includes('@') ? null : '3.11',
      digest: reference.split('@')[1] ?? CURRENT, platform: 'linux/amd64', size: 50_000_000,
      updatedAt: '2026-10-28T00:00:00Z', sourceUrl: 'https://hub.docker.com/_/python',
    } };
    return route.fulfill({ json: report });
  });
  await page.route('**/api/tags?**', (route) => {
    const url = new URL(route.request().url());
    requests.tags.push(url);
    const names = url.searchParams.get('family') === '3.11' ? ['3.11.18', '3.11.18-slim', '3.11-alpine'] : ['3.14', '3.11.18'];
    const search = url.searchParams.get('search') ?? '';
    return route.fulfill({ json: { tags: names.filter((name) => name.includes(search)).map((name) => ({ name, digest: CURRENT, updatedAt: '2026-10-28T00:00:00Z' })), nextPage: null } });
  });
  await page.route('**/api/tag-history?**', (route) => {
    const url = new URL(route.request().url());
    requests.history.push(url);
    return route.fulfill({ json: { status: 'available', entries: url.searchParams.get('page') === '2'
      ? [observation(), observation(OLDER, '3.11.16')] : [observation()], nextPage: url.searchParams.get('page') === '2' ? null : 2 } });
  });
  await page.goto('/?' + new URLSearchParams({ url: 'https://github.com/example/stack', compose: 'compose.yml' }));
  await expect(page.getByRole('region', { name: '분석 결과', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '버전 선택', exact: true }).click();
  return requests;
}

test('puts observed images first, scopes tags to the same family and keeps history after selection', async ({ page }) => {
  const requests = await mockVersionSources(page);
  const drawer = page.getByRole('dialog');
  const history = page.getByRole('region', { name: '태그의 과거 이미지' });
  await expect(history.getByRole('status')).toContainText('1개 이미지 확인');
  await expect(history.locator('.confidence-badge')).toHaveText('과거 기록');
  await expect(history.getByRole('link', { name: /기록 보기$/ })).toHaveAttribute('href', observation().sourceUrl);
  await expect(drawer.getByRole('button', { name: '3.11 계열', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(drawer.locator('.tag-choice')).toHaveCount(3);
  await expect(drawer.locator('.tag-choice').filter({ hasText: '3.14' })).toHaveCount(0);
  expect(requests.tags[0].searchParams.get('family')).toBe('3.11');
  const positions = await drawer.evaluate((element) => ({
    history: element.querySelector('.version-history')!.getBoundingClientRect().top,
    reference: element.querySelector('.version-reference-list')!.getBoundingClientRect().top,
  }));
  expect(positions.history).toBeLessThan(positions.reference);

  await history.getByRole('button', { name: '이전 기록 더 보기', exact: true }).click();
  await expect(history.locator('.history-item')).toHaveCount(2);
  await expect(history.getByRole('status')).toContainText('2개 이미지 확인');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/version-picker-light.png', animations: 'disabled' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: 'test-results/version-picker-dark.png', animations: 'disabled' });
  await drawer.getByRole('button', { name: '전체 태그', exact: true }).click();
  await expect(drawer.locator('.tag-choice').filter({ hasText: '3.14' })).toBeVisible();
  await drawer.getByRole('button', { name: '3.11 계열', exact: true }).click();
  await drawer.getByLabel('태그 검색', { exact: true }).fill('alpine');
  await expect(drawer.locator('.tag-choice')).toHaveCount(1);
  await expect(drawer.locator('.tag-choice')).toContainText('3.11-alpine');
  await expect(history.locator('.history-item')).toHaveCount(2);

  await history.getByRole('button').filter({ hasText: '3.11.17' }).click();
  await expect(drawer).toHaveCount(0);
  const image = page.locator('.image-item');
  await expect(image.getByText('과거 기록', { exact: true })).toBeVisible();
  await expect(image.getByText('digest 고정', { exact: true })).toBeVisible();
  expect(requests.images.at(-1)).toBe(`library/python@${PREVIOUS}`);
  await image.getByRole('button', { name: '버전 선택', exact: true }).click();
  await expect(drawer.locator('.version-reference-list').getByText('과거 기록', { exact: true })).toBeVisible();
  await expect(history.getByRole('status')).toContainText('library/python:3.11');
  await expect(history.getByLabel('현재 분석한 이미지')).toBeVisible();
  await drawer.getByRole('button', { name: 'Compose 원본 버전으로 돌아가기', exact: true }).click();
  await expect(image.getByText('과거 기록', { exact: true })).toHaveCount(0);
  await expect(image.getByRole('button', { name: 'python:3.11 이미지 관계 선택', exact: true })).toBeVisible();
});

test('keeps current tags usable during a history failure and retries without claiming zero history', async ({ page }) => {
  let retry = false;
  await mockVersionSources(page);
  await page.getByRole('button', { name: '상세 패널 닫기' }).click();
  await page.route('**/api/tag-history?**', (route) => retry ? route.fulfill({ json: { status: 'available', entries: [observation()], nextPage: null } })
    : route.fulfill({ status: 429, json: { error: 'GitHub 과거 이미지 기록의 요청 한도에 도달했습니다.' } }));
  await page.getByRole('button', { name: '버전 선택', exact: true }).click();
  const history = page.getByRole('region', { name: '태그의 과거 이미지' });
  await expect(history.getByRole('status')).toContainText('과거 기록 조회 실패');
  await expect(history.getByRole('alert')).toContainText('요청 한도');
  await expect(page.locator('.tag-choice')).toHaveCount(3);
  retry = true;
  await history.getByRole('button', { name: '다시 조회', exact: true }).click();
  await expect(history.getByRole('status')).toContainText('1개 이미지 확인');
  await expect(history.getByRole('alert')).toHaveCount(0);
});

test('distinguishes absent public records from unsupported history', async ({ page }) => {
  await mockVersionSources(page);
  await page.getByRole('button', { name: '상세 패널 닫기' }).click();
  await page.route('**/api/tag-history?**', (route) => route.fulfill({ json: { status: 'available', entries: [], nextPage: null } }));
  await page.getByRole('button', { name: '버전 선택', exact: true }).click();
  const history = page.getByRole('region', { name: '태그의 과거 이미지' });
  await expect(history).toContainText('공개 기록을 찾지 못했습니다.');
  await page.keyboard.press('Escape');
  await page.route('**/api/tag-history?**', (route) => route.fulfill({ json: { status: 'unsupported', entries: [], nextPage: null, message: '태그가 있는 Docker 공식 이미지의 과거 기록을 지원합니다.' } }));
  await page.getByRole('button', { name: '버전 선택', exact: true }).click();
  await expect(history.getByRole('status')).toContainText('과거 기록 지원 대상 아님');
  await expect(history).toContainText('Docker 공식 이미지');
});
