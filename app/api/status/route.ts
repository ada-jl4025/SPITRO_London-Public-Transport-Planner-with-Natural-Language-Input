import { NextRequest, NextResponse } from 'next/server';
import { tflClient } from '@/lib/tfl-client';
import { aiClient } from '@/lib/ai-client';
import type { ApiResponse } from '@/types';
import type { LineStatus, Prediction } from '@/types/tfl';

const STOP_WORDS = ['status', 'line', 'lines', 'service', 'services', 'tube', 'train', 'bus', 'dlr', 'overground'];

const cleanQuerySegment = (segment: string): string => {
  let cleaned = segment.toLowerCase();

  STOP_WORDS.forEach((word) => {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ');
  });

  cleaned = cleaned.replace(/[^a-z0-9&\s-]/g, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
};

const buildLineKeys = (line: LineStatus) => {
  const id = line.id.toLowerCase();
  const name = line.name.toLowerCase();
  const nameNoLine = name.replace(/ line$/, '');
  const normalizedId = id.replace(/[^a-z0-9]/g, '');
  const normalizedName = name.replace(/[^a-z0-9]/g, '');
  const normalizedNoLine = nameNoLine.replace(/[^a-z0-9]/g, '');

  return {
    id,
    name,
    nameNoLine,
    normalizedId,
    normalizedName,
    normalizedNoLine,
  };
};

const evaluateMatch = (line: LineStatus, segment: string) => {
  const keys = buildLineKeys(line);
  const base = segment;
  const noLine = segment.replace(/ line$/, '');
  const normalized = segment.replace(/[^a-z0-9]/g, '');
  const normalizedNoLine = noLine.replace(/[^a-z0-9]/g, '');

  const exact =
    base === keys.name ||
    base === keys.id ||
    noLine === keys.name ||
    noLine === keys.nameNoLine ||
    normalized === keys.normalizedName ||
    normalized === keys.normalizedId ||
    normalizedNoLine === keys.normalizedNoLine;

  const partial =
    !exact &&
    (keys.name.includes(base) ||
      keys.name.includes(noLine) ||
      keys.id.includes(base) ||
      keys.normalizedName.includes(normalized) ||
      keys.normalizedId.includes(normalized));

  return { exact, partial };
};

const findQueryMatches = (lines: LineStatus[], query: string) => {
  const normalizedQuery = query.toLowerCase();

  const segments = normalizedQuery
    .split(/,|&|\/|\band\b/)
    .map((part) => cleanQuerySegment(part))
    .filter(Boolean);

  const searchSegments = segments.length > 0 ? segments : [cleanQuerySegment(normalizedQuery)];

  const exactMatches: LineStatus[] = [];
  const partialMatches: LineStatus[] = [];
  const seenExact = new Set<string>();
  const seenPartial = new Set<string>();

  searchSegments.forEach((segment) => {
    lines.forEach((line) => {
      if (seenExact.has(line.id)) {
        return;
      }

      const { exact, partial } = evaluateMatch(line, segment);

      if (exact && !seenExact.has(line.id)) {
        exactMatches.push(line);
        seenExact.add(line.id);
        seenPartial.delete(line.id);
      } else if (partial && !seenExact.has(line.id) && !seenPartial.has(line.id)) {
        partialMatches.push(line);
        seenPartial.add(line.id);
      }
    });
  });

  return { exactMatches, partialMatches };
};

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const modes = searchParams.get('mode')?.split(',').filter(Boolean);
    const lines = searchParams.get('lines')?.split(',').filter(Boolean);
    const query = searchParams.get('q'); // Natural language query

    const allLineStatuses = await tflClient.getLineStatus();
    const modeSet = modes && modes.length > 0 ? new Set(modes) : null;
    const lineSet = lines && lines.length > 0 ? new Set(lines.map((line) => line.toLowerCase())) : null;

    let filteredStatuses = allLineStatuses;

    if (modeSet) {
      filteredStatuses = filteredStatuses.filter((line) => modeSet.has(line.modeName));
    }

    if (lineSet) {
      filteredStatuses = filteredStatuses.filter(
        (line) => lineSet.has(line.id.toLowerCase()) || lineSet.has(line.name.toLowerCase())
      );
    }

    let prioritizedStatuses: LineStatus[] = [...filteredStatuses];
    const matchedIds = new Set<string>();

    if (query) {
      const { exactMatches, partialMatches } = findQueryMatches(filteredStatuses, query);
      const combinedMatches = [...exactMatches, ...partialMatches];

      if (combinedMatches.length > 0) {
        combinedMatches.forEach((line) => matchedIds.add(line.id));
        const remaining = filteredStatuses.filter((line) => !matchedIds.has(line.id));
        prioritizedStatuses = [...combinedMatches, ...remaining];
      } else {
        const parsedQuery = await aiClient.parseServiceStatusQuery(query);
        const parsedLines = parsedQuery.lines?.map((line) => line.toLowerCase()) ?? [];

        if (parsedLines.length > 0) {
          const parsedMatches = filteredStatuses.filter(
            (line) => parsedLines.includes(line.id.toLowerCase()) || parsedLines.includes(line.name.toLowerCase())
          );

          if (parsedMatches.length > 0) {
            parsedMatches.forEach((line) => matchedIds.add(line.id));
            const remaining = filteredStatuses.filter((line) => !matchedIds.has(line.id));
            prioritizedStatuses = [...parsedMatches, ...remaining];
          }
        } else if (parsedQuery.mode) {
          const modeMatches = filteredStatuses.filter((line) => line.modeName === parsedQuery.mode);

          if (modeMatches.length > 0) {
            modeMatches.forEach((line) => matchedIds.add(line.id));
            const remaining = filteredStatuses.filter((line) => !matchedIds.has(line.id));
            prioritizedStatuses = [...modeMatches, ...remaining];
          }
        }
      }
    }

    const lineIds = prioritizedStatuses.map((line) => line.id);
    const arrivalsMap = new Map<string, Prediction[]>();

    if (lineIds.length > 0) {
      const idChunks = chunkArray(lineIds, 6);

      for (const chunk of idChunks) {
        try {
          const arrivals = await tflClient.getLineArrivals(chunk);

          arrivals.forEach((prediction) => {
            const existing = arrivalsMap.get(prediction.lineId) ?? [];
            existing.push(prediction);
            arrivalsMap.set(prediction.lineId, existing);
          });
        } catch (error) {
          console.error('Arrivals fetch error:', error);
        }
      }
    }

    // Format the response
    const formattedStatuses = prioritizedStatuses.map(line => {
      const arrivals = arrivalsMap.get(line.id) ?? [];
      const upcomingArrivals = [...arrivals]
        .sort((a, b) => a.timeToStation - b.timeToStation)
        .slice(0, 3)
        .map(prediction => ({
          stationName: prediction.stationName,
          destinationName: prediction.destinationName,
          expectedArrival: prediction.expectedArrival,
          timeToStation: prediction.timeToStation,
        }));

      return {
      id: line.id,
      name: line.name,
      modeName: line.modeName,
      severity: line.lineStatuses[0]?.statusSeverity || 10,
      severityDescription: line.lineStatuses[0]?.statusSeverityDescription || 'Good Service',
      reason: line.lineStatuses[0]?.disruption?.description,
      isGoodService: tflClient.isGoodService(line),
      disruptions: line.disruptions?.map(d => ({
        category: d.category,
        description: d.description,
        additionalInfo: d.additionalInfo,
        created: d.created,
        lastUpdate: d.lastUpdate,
      })) || [],
      routeSections: line.routeSections?.map(rs => ({
        name: rs.name,
        direction: rs.direction,
        origination: rs.originationName,
        destination: rs.destinationName,
        })) || [],
        upcomingArrivals,
      };
    });

    // Group by mode for easier display
    const groupedByMode = formattedStatuses.reduce((acc, line) => {
      if (!acc[line.modeName]) {
        acc[line.modeName] = [];
      }
      acc[line.modeName].push(line);
      return acc;
    }, {} as Record<string, typeof formattedStatuses>);

    // Calculate overall status for each mode
    const modeStatuses = Object.entries(groupedByMode).map(([mode, lines]) => {
      const hasDisruption = lines.some(line => !line.isGoodService);
      const severities = lines.map(line => line.severity);
      const minSeverity = Math.min(...severities);
      
      return {
        mode,
        overallStatus: hasDisruption ? 'disrupted' : 'good',
        severity: minSeverity,
        affectedLines: lines.filter(line => !line.isGoodService).map(line => line.name),
        totalLines: lines.length,
      };
    });

    return NextResponse.json<ApiResponse>({
      status: 'success',
      data: {
        lastUpdated: new Date().toISOString(),
        query: query || undefined,
        modes: modeStatuses,
        lines: formattedStatuses,
        groupedByMode,
        matchedLineIds: Array.from(matchedIds),
      },
    });

  } catch (error) {
    console.error('Status check error:', error);
    
    return NextResponse.json<ApiResponse>({
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to fetch service status',
    }, { status: 500 });
  }
}
