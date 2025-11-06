import type { StopPoint, Line } from '@/types/tfl';

const collator = new Intl.Collator('en-GB', {
  numeric: true,
  sensitivity: 'base',
});

const nonWordPattern = /[^a-z0-9]+/g;
const numericPattern = /\d+/g;

const normalize = (value: string): string =>
  value.toLowerCase().replace(nonWordPattern, ' ').replace(/\s+/g, ' ').trim();

const tokenize = (normalized: string): string[] =>
  normalized.length === 0 ? [] : normalized.split(' ');

const numericTokensFromText = (value: string): number[] => {
  const matches = value.match(numericPattern);
  return matches ? matches.map((token) => Number.parseInt(token, 10)).filter((num) => !Number.isNaN(num)) : [];
};

interface StopPointMetadata {
  stop: StopPoint;
  normalizedName: string;
  tokens: string[];
  numericTokens: number[];
  normalizedId: string;
  lineTokens: Set<string>;
  lineNumericTokens: number[];
  length: number;
}

const buildMetadata = (stop: StopPoint): StopPointMetadata => {
  const normalizedName = normalize(stop.commonName || '');
  const tokens = tokenize(normalizedName);
  const numericTokens = numericTokensFromText(normalizedName);

  const lineTokens = new Set<string>();
  const lineNumericTokens: number[] = [];

  (stop.lines || []).forEach((line) => {
    if (line.name) {
      const normalizedLineName = normalize(line.name);
      tokenize(normalizedLineName).forEach((token) => lineTokens.add(token));
      lineNumericTokens.push(...numericTokensFromText(normalizedLineName));
    }
    if (line.id) {
      const normalizedLineId = normalize(line.id);
      tokenize(normalizedLineId).forEach((token) => lineTokens.add(token));
      lineNumericTokens.push(...numericTokensFromText(normalizedLineId));
    }
  });

  const normalizedId = normalize(stop.id || stop.naptanId || '');

  return {
    stop,
    normalizedName,
    tokens,
    numericTokens,
    normalizedId,
    lineTokens,
    lineNumericTokens,
    length: (stop.commonName || '').length,
  };
};

const isNumeric = (value: string): boolean => /^[0-9]+$/.test(value);

const computePriority = (
  metadata: StopPointMetadata,
  queryNormalized: string,
  queryTokens: string[],
  queryLower: string,
): number => {
  if (!queryNormalized) return 6;
  if (metadata.normalizedName === queryNormalized) return 0;
  if (metadata.normalizedId === queryNormalized) return 0;
  if (metadata.tokens.includes(queryNormalized)) return 1;
  if (metadata.lineTokens.has(queryNormalized)) return 1;

  if (queryTokens.length > 1) {
    const hasAllTokens = queryTokens.every((token) => metadata.tokens.includes(token));
    if (hasAllTokens) {
      return 2;
    }
  }

  if (metadata.normalizedName.startsWith(queryNormalized)) return 2;
  if (metadata.tokens.some((token) => token.startsWith(queryNormalized))) return 3;
  if (metadata.lineTokens.size > 0 && Array.from(metadata.lineTokens).some((token) => token.startsWith(queryNormalized))) {
    return 3;
  }

  const lowerName = metadata.stop.commonName.toLowerCase();
  if (lowerName.startsWith(queryLower)) return 4;
  if (lowerName.includes(queryLower)) return 5;

  return 6;
};

const computeNumericDistance = (metadata: StopPointMetadata, queryNumber: number): number => {
  const allNumericTokens = [...metadata.numericTokens, ...metadata.lineNumericTokens];
  if (allNumericTokens.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(
    ...allNumericTokens.map((value) => Math.abs(value - queryNumber)),
  );
};

export const rankStopPoints = (stops: StopPoint[], query: string): StopPoint[] => {
  const queryNormalized = normalize(query);
  const queryLower = query.toLowerCase();
  const queryTokens = tokenize(queryNormalized);
  const numericQuery = isNumeric(queryNormalized) ? Number.parseInt(queryNormalized, 10) : null;

  const metadataList = stops.map(buildMetadata);

  metadataList.sort((a, b) => {
    const priorityA = computePriority(a, queryNormalized, queryTokens, queryLower);
    const priorityB = computePriority(b, queryNormalized, queryTokens, queryLower);

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    if (numericQuery !== null) {
      const diffA = computeNumericDistance(a, numericQuery);
      const diffB = computeNumericDistance(b, numericQuery);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
    }

    if (a.length !== b.length) {
      return a.length - b.length;
    }

    return collator.compare(a.stop.commonName, b.stop.commonName);
  });

  return metadataList.map((meta) => meta.stop);
};

export const sortLinesNaturally = <T extends Pick<Line, 'id' | 'name'>>(lines: T[] | undefined | null): T[] => {
  if (!lines || lines.length <= 1) {
    return Array.isArray(lines) ? [...lines] : [];
  }

  return [...lines].sort((a, b) => {
    const nameA = a.name || a.id || '';
    const nameB = b.name || b.id || '';
    return collator.compare(nameA, nameB);
  });
};

export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

