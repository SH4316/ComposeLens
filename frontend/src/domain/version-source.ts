import { parseImageReference } from '@composelens/shared/image-reference';
import type { ImageState } from './analysis-types';

/** Keep the observed tag when inspecting one of its historical digests. */
export function versionSource(image: ImageState): string | null {
  if (image.history) return image.history.sourceReference;
  try {
    const selected = parseImageReference(image.selectedRef);
    if (selected.tag) return image.selectedRef;
    const declared = parseImageReference(image.spec.declaredRef);
    if (declared.tag && selected.registry === declared.registry && selected.repository === declared.repository) {
      return image.spec.declaredRef;
    }
  } catch { /* Invalid or unresolved references have no tag history. */ }
  return null;
}
