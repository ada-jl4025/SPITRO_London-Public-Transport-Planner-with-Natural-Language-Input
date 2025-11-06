import { NextRequest, NextResponse } from 'next/server';
import { tflClient } from '@/lib/tfl-client';
import { aiClient } from '@/lib/ai-client';
import { geocodingService } from '@/lib/geocoding';
import type { JourneySearchParams, ApiResponse } from '@/types';
import type { NLPJourneyIntent, StationResolution } from '@/lib/schemas/nlp-response';
import type {
  JourneyPlannerParams,
  JourneyPlannerResult,
  Journey,
  Leg,
  Prediction,
} from '@/types/tfl';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

type LegEnhancements = {
  fromName?: string;
  toName?: string;
  platformName?: string;
  direction?: string;
  googleMapsUrl?: string;
  distanceSummary?: string;
  nextArrivals?: Array<{
    id: string;
    destinationName: string;
    expectedArrival: string;
    timeToStation: number;
    platformName?: string;
    towards?: string;
  }>;
};

const isWalkingLeg = (leg: Leg) => leg.mode.id === 'walking';

const buildGoogleMapsUrl = (leg: Leg): string | undefined => {
  const fromLat = leg.departurePoint?.lat;
  const fromLon = leg.departurePoint?.lon;
  const toLat = leg.arrivalPoint?.lat;
  const toLon = leg.arrivalPoint?.lon;

  if (
    typeof fromLat === 'number' &&
    typeof fromLon === 'number' &&
    typeof toLat === 'number' &&
    typeof toLon === 'number'
  ) {
    return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${toLat},${toLon}&travelmode=walking`;
  }

  return undefined;
};

const formatDistanceSummary = (leg: Leg): string | undefined => {
  if (typeof leg.distance === 'number' && leg.distance > 0) {
    const metres = Math.round(leg.distance);
    if (metres >= 1000) {
      return `${(metres / 1000).toFixed(1)} km`;
    }
    return `${metres} m`;
  }

  return undefined;
};

const enhanceLegsWithArrivals = async (journey: Journey): Promise<Array<Leg & { enhancements?: LegEnhancements }>> => {
  const nonWalkingLegs = journey.legs.filter((leg) => !isWalkingLeg(leg));
  const stopPointIds = new Set<string>();

  const legDescriptors = nonWalkingLegs.map((leg) => {
    const stopPointId = leg.departurePoint?.naptanId || leg.departurePoint?.id;
    const parentStationId = leg.departurePoint?.stationNaptan;
    const lineId = leg.routeOptions?.[0]?.lineIdentifier?.id || leg.mode?.id || leg.mode?.name;

    if (stopPointId) {
      stopPointIds.add(stopPointId);
    }
    if (parentStationId) {
      stopPointIds.add(parentStationId);
    }

    return {
      leg,
      stopPointId,
      parentStationId,
      lineId: lineId ? lineId.toLowerCase() : undefined,
    } as const;
  });

  let arrivals: Prediction[] = [];

  if (stopPointIds.size > 0) {
    try {
      arrivals = await tflClient.getMultipleArrivals(Array.from(stopPointIds));
    } catch (error) {
      console.error('Failed to fetch arrivals for journey legs:', error);
      arrivals = [];
    }
  }

  const sortedArrivals = [...arrivals].sort((a, b) => a.timeToStation - b.timeToStation);

  const results = await Promise.all(journey.legs.map(async (leg) => {
    const fromName = leg.departurePoint?.commonName;
    const toName = leg.arrivalPoint?.commonName;

    const baseEnhancements: LegEnhancements = {
      fromName,
      toName,
      distanceSummary: formatDistanceSummary(leg),
    };

    if (isWalkingLeg(leg)) {
      baseEnhancements.googleMapsUrl = buildGoogleMapsUrl(leg);
      return {
        ...leg,
        enhancements: baseEnhancements,
      };
    }

    const descriptor = legDescriptors.find((item) => item.leg === leg);

    if (descriptor?.stopPointId) {
      const candidateStopIds = [descriptor.stopPointId, descriptor.parentStationId].filter(Boolean) as string[];
      const mapPrediction = (prediction: Prediction) => ({
        id: prediction.id,
        destinationName: prediction.destinationName,
        expectedArrival: prediction.expectedArrival,
        timeToStation: prediction.timeToStation,
        platformName: prediction.platformName,
        towards: prediction.towards || prediction.direction,
      });

      const filterFromCache = (preds: Prediction[]) => preds
        .filter((prediction) => candidateStopIds.includes(prediction.naptanId))
        .sort((a, b) => a.timeToStation - b.timeToStation);

      let relevantArrivals = [] as ReturnType<typeof mapPrediction>[];

      // Prefer same line at the same stop/parent station
      if (descriptor.lineId) {
        relevantArrivals = filterFromCache(sortedArrivals)
          .filter((prediction) => prediction.lineId?.toLowerCase() === descriptor.lineId)
          .slice(0, 3)
          .map(mapPrediction);
      }

      // Fallback: any line from the same stop/parent station
      if (relevantArrivals.length === 0) {
        relevantArrivals = filterFromCache(sortedArrivals)
          .slice(0, 3)
          .map(mapPrediction);
      }

      // Final fallback: query line-specific arrivals for this stop
      if (relevantArrivals.length === 0 && descriptor.lineId) {
        try {
          const lineArrivals = await tflClient.getLineArrivals([descriptor.lineId], descriptor.stopPointId);
          const sortedLineArrivals = lineArrivals
            .filter((p) => candidateStopIds.includes(p.naptanId))
            .sort((a, b) => a.timeToStation - b.timeToStation);
          relevantArrivals = sortedLineArrivals.slice(0, 3).map(mapPrediction);
        } catch (e) {
          // Ignore and leave as empty if this also fails
        }
      }

      baseEnhancements.nextArrivals = relevantArrivals;
      baseEnhancements.platformName = relevantArrivals[0]?.platformName || undefined;
    }

    baseEnhancements.direction = leg.routeOptions?.[0]?.directions?.[0] || leg.instruction?.summary;

    return {
      ...leg,
      enhancements: baseEnhancements,
    };
  }));

  return results;
};

export async function POST(request: NextRequest) {
  try {
    const body: JourneySearchParams = await request.json();

    let fromLocation: string | null = null;
    let toLocation: string | null = null;
    let fromName: string | undefined;
    let toName: string | undefined;

    // Process natural language query
    if (body.naturalLanguageQuery) {
      // Parse the query with Azure OpenAI
      const nlpIntent: NLPJourneyIntent = await aiClient.parseJourneyIntent(body.naturalLanguageQuery);

      if (nlpIntent.intent_confidence < 0.3) {
        return NextResponse.json<ApiResponse>({
          status: 'error',
          error: 'Could not understand your query. Please try rephrasing or use manual station selection.',
        }, { status: 400 });
      }

      // Check if this is a journey planning intent
      if (nlpIntent.type !== 'journey_planning' || !nlpIntent.journey) {
        return NextResponse.json<ApiResponse>({
          status: 'error',
          error: 'This appears to be a service status query. Please use the status page.',
        }, { status: 400 });
      }

      // Handle ambiguities
      if (nlpIntent.ambiguities && nlpIntent.ambiguities.length > 0) {
        const clarifyingQuestions = await aiClient.clarifyAmbiguousQuery(
          body.naturalLanguageQuery,
          nlpIntent.ambiguities
        );

        return NextResponse.json<ApiResponse>({
          status: 'error',
          error: 'Need more information',
          data: {
            ambiguities: nlpIntent.ambiguities,
            suggestions: clarifyingQuestions,
          },
        }, { status: 400 });
      }

      // Process FROM location
      if (nlpIntent.journey.from?.useCurrentLocation) {
        if (body.from) {
          if (body.from.includes(',')) {
            fromLocation = body.from;
            fromName = nlpIntent.journey.from?.name || 'Current location';
          } else {
            const fromStations = await tflClient.searchStopPoints(body.from);
            if (fromStations.length > 0) {
              fromLocation = tflClient.formatStopPointForJourney(fromStations[0]);
              fromName = fromStations[0].commonName;
            }
          }

          if (!fromLocation) {
            return NextResponse.json<ApiResponse>({
              status: 'error',
              error: `Could not resolve starting location: ${body.from}`,
            }, { status: 400 });
          }
        } else {
          return NextResponse.json<ApiResponse>({
            status: 'error',
            error: 'location_required',
            data: {
              message: 'Please share your location to use as starting point',
              intent: nlpIntent,
            },
          }, { status: 400 });
        }
      } else if (nlpIntent.journey.from?.name) {
        // Enhance location name with AI
        const enhancedFromName = await aiClient.enhanceLocationName(nlpIntent.journey.from.name);
        
        // Search for the station
        const fromStations = await tflClient.searchStopPoints(enhancedFromName);
        
        if (fromStations.length === 0) {
          // Try geocoding
          const geocodeResults = await geocodingService.geocode(nlpIntent.journey.from.name);
          if (geocodeResults.length > 0) {
            fromLocation = `${geocodeResults[0].lat},${geocodeResults[0].lon}`;
            fromName = geocodeResults[0].name;
          } else {
            return NextResponse.json<ApiResponse>({
              status: 'error',
              error: `Could not find location: ${nlpIntent.journey.from.name}`,
            }, { status: 400 });
          }
        } else {
          fromLocation = tflClient.formatStopPointForJourney(fromStations[0]);
          fromName = fromStations[0].commonName;
        }
      }

      // Process TO location (required)
      if (!nlpIntent.journey.to?.name) {
        return NextResponse.json<ApiResponse>({
          status: 'error',
          error: 'Destination is required',
        }, { status: 400 });
      }

      // Enhance location name with AI
      const enhancedToName = await aiClient.enhanceLocationName(nlpIntent.journey.to.name);
      
      // Search for the destination station
      const toStations = await tflClient.searchStopPoints(enhancedToName);
      
      if (toStations.length === 0) {
        // Try geocoding
        const geocodeResults = await geocodingService.geocode(nlpIntent.journey.to.name);
        if (geocodeResults.length > 0) {
          toLocation = `${geocodeResults[0].lat},${geocodeResults[0].lon}`;
          toName = geocodeResults[0].name;
        } else {
          return NextResponse.json<ApiResponse>({
            status: 'error',
            error: `Could not find destination: ${nlpIntent.journey.to.name}`,
          }, { status: 400 });
        }
      } else {
        toLocation = tflClient.formatStopPointForJourney(toStations[0]);
        toName = toStations[0].commonName;
      }

      // TODO: Handle VIA locations and preferences
    } else {
      // Manual station selection
      if (!body.to) {
        return NextResponse.json<ApiResponse>({
          status: 'error',
          error: 'Destination is required',
        }, { status: 400 });
      }

      // Handle FROM location
      if (body.from) {
        if (body.from.includes(',')) {
          // Already coordinates
          fromLocation = body.from;
        } else {
          // Search for station
          const fromStations = await tflClient.searchStopPoints(body.from);
          if (fromStations.length > 0) {
            fromLocation = tflClient.formatStopPointForJourney(fromStations[0]);
            fromName = fromStations[0].commonName;
          } else {
            return NextResponse.json<ApiResponse>({
              status: 'error',
              error: `Could not find starting location: ${body.from}`,
            }, { status: 400 });
          }
        }
      } else {
        // No FROM specified - client should provide current location
        return NextResponse.json<ApiResponse>({
          status: 'error',
          error: 'location_required',
          data: {
            message: 'Starting location is required',
          },
        }, { status: 400 });
      }

      // Handle TO location
      if (body.to.includes(',')) {
        // Already coordinates
        toLocation = body.to;
      } else {
        // Search for station
        const toStations = await tflClient.searchStopPoints(body.to);
        if (toStations.length > 0) {
          toLocation = tflClient.formatStopPointForJourney(toStations[0]);
          toName = toStations[0].commonName;
        } else {
          return NextResponse.json<ApiResponse>({
            status: 'error',
            error: `Could not find destination: ${body.to}`,
          }, { status: 400 });
        }
      }
    }

    // Ensure we have both locations
    if (!fromLocation || !toLocation) {
      return NextResponse.json<ApiResponse>({
        status: 'error',
        error: 'Both starting point and destination are required',
      }, { status: 400 });
    }

    // Plan the journey
    const journeyParams: JourneyPlannerParams = {
      from: fromLocation,
      to: toLocation,
      fromName,
      toName,
      nationalSearch: false,
      journeyPreference: 'LeastTime',
      accessibilityPreference: body.preferences?.accessibility?.includes('step-free-vehicle') 
        ? 'StepFreeToVehicle' 
        : body.preferences?.accessibility?.includes('step-free-platform')
        ? 'StepFreeToPlatform'
        : 'NoRequirements',
      mode: body.preferences?.modes || ['tube', 'bus', 'dlr', 'overground', 'walking'],
      alternativeRoute: true,
      walkingSpeed: 'Average',
    };

    const journeyResult = await tflClient.planJourney(journeyParams);

    // Generate accessible descriptions and enhanced legs for the journeys
    const journeysWithDescriptions = await Promise.all(
      journeyResult.journeys.slice(0, 3).map(async (journey) => {
        const [accessibleDescription, enhancedLegs] = await Promise.all([
          aiClient.generateAccessibleDescription(journey),
          enhanceLegsWithArrivals(journey),
        ]);

        return {
          ...journey,
          legs: enhancedLegs,
          accessibleDescription,
        };
      })
    );

    return NextResponse.json<ApiResponse>({
      status: 'success',
      data: {
        ...journeyResult,
        journeys: journeysWithDescriptions,
        fromName,
        toName,
      },
    });

  } catch (error) {
    console.error('Journey planning error:', error);
    
    return NextResponse.json<ApiResponse>({
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to plan journey',
    }, { status: 500 });
  }
}
