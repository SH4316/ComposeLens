import { parseImageReference } from '@composelens/shared/image-reference';
import { SEVERITIES, type Finding, type Severity } from '@composelens/shared';
import type {
  Filters,
  ImageState,
  LinkedFinding,
  RelationEdge,
  RelationGraph,
  VulnerabilityNode,
} from './types';

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

function isPinned(reference: string): boolean {
  try {
    return parseImageReference(reference).pinned;
  } catch {
    return false;
  }
}

function searchableImage(image: ImageState): string {
  return [
    image.selectedRef,
    image.spec.declaredRef,
    image.spec.services.join(' '),
    image.spec.platform,
    image.report?.metadata?.digest,
    image.report?.metadata?.repository,
  ].join(' ').toLowerCase();
}

function searchableFinding(finding: Finding): string {
  return [
    finding.cve,
    finding.packageName,
    finding.packageVersion,
    finding.fixedVersion,
    finding.purl,
    finding.source,
    finding.description,
  ].join(' ').toLowerCase();
}

function matchesFinding(finding: Finding, filters: Filters): boolean {
  if (filters.severities.length && !filters.severities.includes(finding.severity)) return false;
  const hasFix = Boolean(finding.fixedVersion?.trim());
  return filters.fix === 'all' || (filters.fix === 'available' ? hasFix : !hasFix);
}

function linkFinding(finding: Finding, image: ImageState): LinkedFinding {
  return {
    ...finding,
    imageId: image.spec.id,
    imageReference: image.selectedRef,
    imageServices: [...image.spec.services],
  };
}

function compareFindings(left: LinkedFinding, right: LinkedFinding): number {
  return severityRank(left.severity) - severityRank(right.severity)
    || left.imageReference.localeCompare(right.imageReference)
    || left.packageName.localeCompare(right.packageName)
    || left.packageVersion.localeCompare(right.packageVersion)
    || left.source.localeCompare(right.source);
}

/** Filter actual package findings first; every displayed node and edge follows that result. */
export function buildGraph(images: ImageState[], filters: Filters): RelationGraph {
  const search = filters.search.trim().toLowerCase();
  const severityFilter = filters.severities.length > 0 && filters.severities.length < SEVERITIES.length;
  const hasFindingFilters = severityFilter || filters.fix !== 'all';
  const hasFilters = Boolean(search) || hasFindingFilters;
  const visibleImages: ImageState[] = [];
  const nodes = new Map<string, VulnerabilityNode>();
  const edges: RelationEdge[] = [];

  for (const image of images) {
    const imageMatches = Boolean(search) && searchableImage(image).includes(search);
    const findings = (image.report?.findings ?? []).filter((finding) => (
      matchesFinding(finding, filters)
      && (!search || imageMatches || searchableFinding(finding).includes(search))
    ));

    if (hasFilters && !findings.length && !(imageMatches && !hasFindingFilters)) continue;
    visibleImages.push(image);

    const linkedCves = new Set<string>();
    const seenFindings = new Set<string>();
    for (const finding of findings) {
      if (!finding.cve.trim()) continue;
      const findingKey = `${finding.cve}:${finding.id}`;
      if (seenFindings.has(findingKey)) continue;
      seenFindings.add(findingKey);

      const existing = nodes.get(finding.cve);
      if (existing) {
        existing.findings.push(linkFinding(finding, image));
        if (severityRank(finding.severity) < severityRank(existing.severity)) existing.severity = finding.severity;
      } else {
        nodes.set(finding.cve, {
          id: finding.cve,
          cve: finding.cve,
          severity: finding.severity,
          findings: [linkFinding(finding, image)],
        });
      }
      linkedCves.add(finding.cve);
    }

    for (const cve of linkedCves) {
      edges.push({
        id: `${image.spec.id}->${cve}`,
        imageId: image.spec.id,
        vulnerabilityId: cve,
        uncertain: !isPinned(image.selectedRef),
      });
    }
  }

  const vulnerabilities = [...nodes.values()].sort((left, right) => (
    severityRank(left.severity) - severityRank(right.severity) || left.cve.localeCompare(right.cve)
  ));
  vulnerabilities.forEach((node) => node.findings.sort(compareFindings));

  return { images: visibleImages, vulnerabilities, edges };
}
