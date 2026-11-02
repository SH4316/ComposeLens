import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCompose } from '../domain/compose-parser';
import type { ImageSpec, ImageState, RepositoryFile } from '../domain/analysis-types';
import { fetchImageReport } from '../services/image-api-client';
import { fetchComposeFile } from '../services/github-file-client';
import { resolveBuildImages } from '../services/build-image-resolver';

interface AnalysisState {
  source: RepositoryFile | null;
  images: ImageState[];
  warnings: string[];
  loadingFile: boolean;
  error: string | null;
}

const INITIAL_STATE: AnalysisState = {
  source: null, images: [], warnings: [], loadingFile: false, error: null,
};

function initialImage(spec: ImageSpec): ImageState {
  return {
    spec,
    selectedRef: spec.declaredRef,
    report: null,
    status: spec.issue ? 'error' : 'idle',
    error: spec.issue ?? null,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '조회 중 문제가 발생했습니다.';
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const generation = useRef(0);
  const fileController = useRef<AbortController | null>(null);
  const imageControllers = useRef(new Map<string, AbortController>());

  const cancel = useCallback(() => {
    fileController.current?.abort();
    imageControllers.current.forEach((controller) => controller.abort());
    imageControllers.current.clear();
  }, []);

  useEffect(() => cancel, [cancel]);

  const loadImage = useCallback(async (image: ImageState, currentGeneration: number, reference = image.selectedRef) => {
    const id = image.spec.id;
    imageControllers.current.get(id)?.abort();
    const controller = new AbortController();
    imageControllers.current.set(id, controller);

    const update = (patch: Partial<ImageState>) => {
      if (generation.current !== currentGeneration || controller.signal.aborted) return;
      setState((previous) => ({
        ...previous,
        images: previous.images.map((item) => item.spec.id === id ? { ...item, ...patch } : item),
      }));
    };

    update({ selectedRef: reference, status: 'loading', report: null, error: null });
    try {
      const report = await fetchImageReport(reference, image.spec.platform, controller.signal);
      update({ report, status: 'done' });
    } catch (error) {
      update({ status: 'error', error: errorMessage(error) });
    } finally {
      if (imageControllers.current.get(id) === controller) imageControllers.current.delete(id);
    }
  }, []);

  const analyze = useCallback(async (repositoryUrl: string, path: string): Promise<boolean> => {
    cancel();
    const currentGeneration = ++generation.current;
    const controller = new AbortController();
    fileController.current = controller;
    setState({ ...INITIAL_STATE, loadingFile: true });

    try {
      const source = await fetchComposeFile(repositoryUrl, path, controller.signal);
      if (controller.signal.aborted) return false;
      const parsed = await resolveBuildImages(parseCompose(source.content), source, controller.signal);
      if (controller.signal.aborted || generation.current !== currentGeneration) return false;
      const images = parsed.images.map(initialImage);
      setState({ source, images, warnings: parsed.warnings, loadingFile: false, error: null });

      // A small work queue avoids sending every image upstream at once.
      const queue = images.filter((image) => !image.spec.issue);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (!controller.signal.aborted && generation.current === currentGeneration) {
          const image = queue[cursor++];
          if (!image) return;
          await loadImage(image, currentGeneration);
        }
      }));
      return !controller.signal.aborted && generation.current === currentGeneration;
    } catch (error) {
      if (controller.signal.aborted || generation.current !== currentGeneration) return false;
      setState({ ...INITIAL_STATE, error: errorMessage(error) });
      return false;
    }
  }, [cancel, loadImage]);

  const changeReference = useCallback((image: ImageState, reference: string) => {
    void loadImage(image, generation.current, reference);
  }, [loadImage]);

  const retryImage = useCallback((image: ImageState) => {
    void loadImage(image, generation.current);
  }, [loadImage]);

  const busy = state.loadingFile || state.images.some((image) => image.status === 'loading' || image.status === 'idle');
  return { ...state, busy, analyze, changeReference, retryImage };
}
