import { NextRequest, NextResponse } from 'next/server';
import { tflClient } from '@/lib/tfl-client';
import { rankStopPoints, sortLinesNaturally } from '@/lib/search-ranking';
import type { ApiResponse } from '@/types';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const modes = searchParams.get('modes')?.split(',').filter(Boolean);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!query || query.trim().length < 2) {
      return NextResponse.json<ApiResponse>({
        status: 'error',
        error: 'Search query must be at least 2 characters',
      }, { status: 400 });
    }

    // Search for stations
    const stations = await tflClient.searchStopPoints(query, modes);

    // Sort by relevance and limit results
    const sortedStations = rankStopPoints(stations, query).slice(0, limit);

    // Format the results
    const formattedStations = sortedStations.map(station => ({
      id: station.id,
      naptanId: station.naptanId,
      name: station.commonName,
      modes: station.modes || [],
      lat: station.lat,
      lon: station.lon,
      zone: station.zone,
      lines: sortLinesNaturally(station.lines).map(line => ({
        id: line.id,
        name: line.name,
      })) || [],
    }));

    return NextResponse.json<ApiResponse>({
      status: 'success',
      data: {
        query,
        results: formattedStations,
        total: formattedStations.length,
      },
    });

  } catch (error) {
    console.error('Station search error:', error);
    
    return NextResponse.json<ApiResponse>({
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to search stations',
    }, { status: 500 });
  }
}
