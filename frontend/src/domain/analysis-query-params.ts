/** Reads and writes shareable analysis inputs in URL query parameters. */
export interface AnalysisLocation {
  repository: string;
  path: string;
}

const DEFAULT_COMPOSE_PATH = 'compose.yml';

export function readAnalysisLocation(search: string): AnalysisLocation {
  const params = new URLSearchParams(search);
  return {
    repository: params.get('url')?.trim() ?? '',
    path: params.get('compose')?.trim() || DEFAULT_COMPOSE_PATH,
  };
}

export function analysisLocationUrl(currentUrl: string, input: AnalysisLocation): string {
  const url = new URL(currentUrl);
  url.searchParams.set('url', input.repository.trim());
  url.searchParams.set('compose', input.path.trim() || DEFAULT_COMPOSE_PATH);
  return url.href;
}
