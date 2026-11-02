import { ApiError } from './http';

export interface ImagePlatform {
  os: string;
  architecture: string;
  variant?: string | null;
}

export function validatePlatform(platform: string): string {
  if (platform.length > 64 || !/^[a-z0-9]+\/[a-z0-9]+(?:\/[a-z0-9]+)?$/.test(platform)) {
    throw new ApiError('플랫폼은 linux/amd64 또는 linux/arm64/v8 형식으로 입력해 주세요.', 400);
  }
  return platform;
}

export function platformName(platform: ImagePlatform): string {
  return [platform.os, platform.architecture, platform.variant].filter(Boolean).join('/');
}

export function matchesPlatform(actual: ImagePlatform, requested: string): boolean {
  const [os, architecture, variant] = requested.split('/');
  return actual.os === os
    && actual.architecture === architecture
    && (!variant || actual.variant === variant);
}

export function findPlatform<T extends ImagePlatform>(images: T[], requested: string): T | undefined {
  const matches = images.filter((image) => matchesPlatform(image, requested));
  return matches.find((image) => platformName(image) === requested) ?? matches[0];
}

export function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value);
}
