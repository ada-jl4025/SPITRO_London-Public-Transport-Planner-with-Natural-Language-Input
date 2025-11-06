import { config } from './config';
import { rankStopPoints } from './search-ranking';
import type {
  StopPoint,
  JourneyPlannerResult,
  JourneyPlannerParams,
  Prediction,
  LineStatus,
} from '@/types/tfl';

const DEFAULT_STATUS_MODES = ['tube', 'bus', 'dlr', 'overground', 'tram', 'river-bus', 'cable-car'] as const;

const buildModeVariants = (mode: string): string[] => {
  const normalized = mode.trim().toLowerCase();
  const variants = new Set<string>([normalized]);

  if (normalized.includes('-')) {
    variants.add(normalized.replace(/-/g, ''));
  }

  if (normalized.includes(' ')) {
    variants.add(normalized.replace(/\s+/g, ''));
  }

  // Explicit mappings for known transport modes with special formatting
  if (normalized === 'river-bus') {
    variants.add('riverbus');
  }

  if (normalized === 'cable-car') {
    variants.add('cablecar');
  }

  return Array.from(variants);
};

interface TflClientError extends Error {
  status?: number;
  isRateLimit?: boolean;
  details?: unknown;
  retryAfterMs?: number;
}

class TFLApiClient {
  private baseUrl: string;
  private apiKeys: string[];
  private rateLimitCooldowns: Map<string, number>;
  private roundRobinIndex: number;
  private headers: HeadersInit;

  constructor(apiKeysOverride?: string[]) {
    this.baseUrl = config.tfl.baseUrl;
    // Prefer explicit list if provided; otherwise fall back to primary/secondary
    const configuredKeys = Array.isArray(apiKeysOverride)
      ? (apiKeysOverride as string[])
      : (Array.isArray((config as any).tfl.apiKeys) ? ((config as any).tfl.apiKeys as string[]) : []);
    const legacyKeys = [config.tfl.primaryApiKey, config.tfl.secondaryApiKey].filter(
      (k): k is string => !!k && k.length > 0
    );
    this.apiKeys = (configuredKeys.length > 0 ? configuredKeys : legacyKeys).filter(
      (k, idx, arr) => arr.indexOf(k) === idx
    );
    this.rateLimitCooldowns = new Map();
    this.roundRobinIndex = 0;
    this.headers = {
      'Content-Type': 'application/json',
    };
  }

  private buildUrl(endpoint: string, params?: Record<string, any>, apiKey?: string): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            url.searchParams.append(key, value.join(','));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    // Add API key if available
    if (apiKey) {
      url.searchParams.append('app_key', apiKey);
    }

    return url.toString();
  }

  private async fetchApi<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    const apiKeys = this.getApiKeysInPriorityOrder();
    let lastError: unknown;

    for (let index = 0; index < apiKeys.length; index++) {
      const apiKey = apiKeys[index];

      try {
        const result = await this.requestWithKey<T>(endpoint, params, apiKey);
        // Advance round-robin only when we successfully used a real key
        if (apiKey) {
          this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(this.apiKeys.length, 1);
        }
        return result;
      } catch (error) {
        lastError = error;

        // If rate-limited on a specific key, mark it as cooling down
        if (apiKey && this.isRateLimitError(error)) {
          const retryAfterMs = (error as Partial<TflClientError>).retryAfterMs;
          const cooldownMs = typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : 60_000;
          this.rateLimitCooldowns.set(apiKey, Date.now() + cooldownMs);
        }

        const shouldRetry = this.shouldRetryWithNextKey(error, index, apiKeys.length);
        if (shouldRetry) {
          const keyLabel = index === 0 ? 'primary' : 'current';
          console.warn(`TFL API rate limit encountered using ${keyLabel} key, retrying with backup key`);
          continue;
        }

        console.error('TFL API fetch error:', error);
        throw error;
      }
    }

    if (lastError) {
      console.error('TFL API fetch error:', lastError);
      throw lastError;
    }

    throw new Error('TFL API request failed');
  }

  private getApiKeysInPriorityOrder(): (string | undefined)[] {
    const now = Date.now();
    const usableKeys: string[] = [];

    if (this.apiKeys.length > 0) {
      // Build a rotated view for round-robin starting point
      for (let i = 0; i < this.apiKeys.length; i++) {
        const idx = (this.roundRobinIndex + i) % this.apiKeys.length;
        const key = this.apiKeys[idx];
        const cooldownUntil = this.rateLimitCooldowns.get(key) || 0;
        if (cooldownUntil <= now) {
          usableKeys.push(key);
        }
      }
    }

    // If no configured keys or all are cooling down, include undefined (no key) as a last resort
    if (usableKeys.length === 0) {
      return [undefined];
    }

    // Try configured usable keys first, then consider no-key as very last fallback
    return [...usableKeys, undefined];
  }

  private shouldRetryWithNextKey(error: unknown, attemptIndex: number, totalKeys: number): boolean {
    return attemptIndex < totalKeys - 1 && this.isRateLimitError(error);
  }

  private isRateLimitError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const maybeClientError = error as Partial<TflClientError>;

    if (maybeClientError.isRateLimit) {
      return true;
    }

    if (maybeClientError.status === 429) {
      return true;
    }

    const message = (error as Error).message;
    if (typeof message === 'string') {
      const normalized = message.toLowerCase();
      return (
        normalized.includes('rate limit') ||
        normalized.includes('too many requests') ||
        normalized.includes('exceeded your quota') ||
        normalized.includes('quota exceeded') ||
        normalized.includes('over rate limit')
      );
    }

    return false;
  }

  private isRateLimitResponse(status?: number, message?: string): boolean {
    if (status === 429) {
      return true;
    }

    if (!message) {
      return false;
    }

    const normalized = message.toLowerCase();
    return (
      normalized.includes('rate limit') ||
      normalized.includes('too many requests') ||
      normalized.includes('exceeded your quota') ||
      normalized.includes('quota exceeded') ||
      normalized.includes('over rate limit')
    );
  }

  private async requestWithKey<T>(
    endpoint: string,
    params: Record<string, any> | undefined,
    apiKey?: string
  ): Promise<T> {
    const url = this.buildUrl(endpoint, params, apiKey);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      throw await this.buildError(response);
    }

    return response.json() as Promise<T>;
  }

  private async buildError(response: Response): Promise<TflClientError> {
    const clonedResponse = response.clone();
    let body: unknown = null;
    let message: string | undefined;
    let retryAfterMs: number | undefined;

    try {
      const parsed = await clonedResponse.json();
      body = parsed;

      if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as any).message === 'string') {
        message = (parsed as any).message;
      }
    } catch {
      try {
        const text = await response.text();
        if (text) {
          body = text;
          message = text;
        }
      } catch {
        body = null;
      }
    }

    // Parse Retry-After header when present (seconds or HTTP-date)
    const retryAfterRaw = response.headers.get('retry-after');
    if (retryAfterRaw) {
      const seconds = Number(retryAfterRaw);
      if (!Number.isNaN(seconds)) {
        retryAfterMs = Math.max(0, seconds) * 1000;
      } else {
        const dateMs = Date.parse(retryAfterRaw);
        if (!Number.isNaN(dateMs)) {
          retryAfterMs = Math.max(0, dateMs - Date.now());
        }
      }
    }

    const errorMessage = message || `TFL API error: ${response.status}`;
    const error: TflClientError = new Error(errorMessage);
    error.status = response.status;
    error.details = body;
    error.isRateLimit = this.isRateLimitResponse(response.status, message);
    if (retryAfterMs !== undefined) {
      error.retryAfterMs = retryAfterMs;
    }

    return error;
  }

  // Journey Planning
  async planJourney(params: JourneyPlannerParams): Promise<JourneyPlannerResult> {
    const endpoint = `/Journey/JourneyResults/${params.from}/to/${params.to}`;
    
    // Remove from and to from params as they're in the URL
    const { from, to, ...queryParams } = params;
    
    return this.fetchApi<JourneyPlannerResult>(endpoint, queryParams);
  }

  // Stop Point Search
  async searchStopPoints(query: string, modes?: string[]): Promise<StopPoint[]> {
    const params: Record<string, any> = {
      query,
      maxResults: 20,
    };

    if (modes && modes.length > 0) {
      params.modes = modes;
    }

    const response = await this.fetchApi<{ matches: StopPoint[] }>('/StopPoint/Search', params);
    const matches = response.matches || [];
    return rankStopPoints(matches, query);
  }

  // Get Stop Point by ID
  async getStopPoint(id: string): Promise<StopPoint> {
    return this.fetchApi<StopPoint>(`/StopPoint/${id}`);
  }

  // Get Nearby Stop Points
  async getNearbyStopPoints(
    lat: number,
    lon: number,
    radius: number = 500,
    modes?: string[],
    categories?: string[]
  ): Promise<StopPoint[]> {
    const params: Record<string, any> = {
      lat,
      lon,
      radius,
      stopTypes: 'NaptanMetroStation,NaptanRailStation,NaptanBusCoachStation,NaptanFerryPort,NaptanPublicBusCoachTram',
    };

    if (modes && modes.length > 0) {
      params.modes = modes;
    }

    if (categories && categories.length > 0) {
      params.categories = categories;
    }

    const response = await this.fetchApi<{ stopPoints: StopPoint[] }>('/StopPoint', params);
    return response.stopPoints || [];
  }

  // Arrivals
  async getArrivals(stopPointId: string): Promise<Prediction[]> {
    return this.fetchApi<Prediction[]>(`/StopPoint/${stopPointId}/Arrivals`);
  }

  // Get arrivals for multiple stop points
  async getMultipleArrivals(stopPointIds: string[]): Promise<Prediction[]> {
    const uniqueIds = Array.from(new Set(stopPointIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));

    if (uniqueIds.length === 0) {
      return [];
    }

    if (uniqueIds.length === 1) {
      return this.getArrivals(uniqueIds[0]);
    }

    const arrivalsByStop = await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          return await this.getArrivals(id);
        } catch (error) {
          console.warn('TFL arrivals fetch failed for stop', id, error);
          return [] as Prediction[];
        }
      })
    );

    return arrivalsByStop.flat();
  }

  // Get arrivals for specific lines
  async getLineArrivals(lineIds: string[], stopPointId?: string): Promise<Prediction[]> {
    if (lineIds.length === 0) return [];

    const ids = lineIds.join(',');
    const params: Record<string, any> = {};

    if (stopPointId) {
      params.stopPointId = stopPointId;
    }

    return this.fetchApi<Prediction[]>(`/Line/${ids}/Arrivals`, params);
  }

  // Line Status
  async getLineStatus(modes?: string[]): Promise<LineStatus[]> {
    const requestedModes = (modes && modes.length > 0 ? modes : DEFAULT_STATUS_MODES).map((mode) => mode.toLowerCase());

    const bulkEndpoint = `/Line/Mode/${requestedModes.join(',')}/Status`;

    try {
      return await this.fetchApi<LineStatus[]>(bulkEndpoint);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
      const shouldFallback = errorMessage.includes('string did not match the expected pattern');

      if (!shouldFallback) {
        throw error;
      }

      const aggregated: LineStatus[] = [];
      const failedModes: string[] = [];

      for (const mode of requestedModes) {
        const variants = buildModeVariants(mode);
        let succeeded = false;

        for (const variant of variants) {
          try {
            const data = await this.fetchApi<LineStatus[]>(`/Line/Mode/${variant}/Status`);
            aggregated.push(...data);
            succeeded = true;
            break;
          } catch (variantError) {
            const variantMessage = variantError instanceof Error ? variantError.message.toLowerCase() : '';

            if (!variantMessage.includes('string did not match the expected pattern')) {
              console.error('TFL API fetch error for mode variant', { mode, variant, error: variantError });
              break;
            }
          }
        }

        if (!succeeded) {
          failedModes.push(mode);
        }
      }

      if (aggregated.length > 0) {
        if (failedModes.length > 0) {
          console.warn('TFL API status fallback skipped modes:', failedModes.join(', '));
        }

        return aggregated;
      }

      throw error;
    }
  }

  // Get status for specific lines
  async getSpecificLineStatus(lineIds: string[]): Promise<LineStatus[]> {
    if (lineIds.length === 0) return [];
    
    const ids = lineIds.join(',');
    return this.fetchApi<LineStatus[]>(`/Line/${ids}/Status`);
  }

  // Get all tube lines
  async getTubeLines(): Promise<LineStatus[]> {
    return this.fetchApi<LineStatus[]>('/Line/Mode/tube');
  }

  // Get disruptions for all modes
  async getDisruptions(modes?: string[]): Promise<LineStatus[]> {
    let endpoint = '/Line/Mode';
    
    if (modes && modes.length > 0) {
      endpoint += `/${modes.join(',')}/Disruption`;
    } else {
      endpoint = '/Line/Disruption';
    }

    return this.fetchApi<LineStatus[]>(endpoint);
  }

  // Search for a place/POI
  async searchPlace(name: string, types?: string[]): Promise<any[]> {
    const params: Record<string, any> = {
      name,
    };

    if (types && types.length > 0) {
      params.types = types;
    }

    const response = await this.fetchApi<{ matches: any[] }>('/Place/Search', params);
    return response.matches || [];
  }

  // Get place information
  async getPlace(id: string): Promise<any> {
    return this.fetchApi<any>(`/Place/${id}`);
  }

  // Get route sequence for a line
  async getRouteSequence(lineId: string, direction: 'inbound' | 'outbound'): Promise<any> {
    return this.fetchApi<any>(`/Line/${lineId}/Route/Sequence/${direction}`);
  }

  // Utility method to format stop point ID for journey planning
  formatStopPointForJourney(stopPoint: StopPoint): string {
    // For journey planning, TFL accepts either coordinates or stop point IDs
    // Using coordinates is more flexible as it works for any location
    return `${stopPoint.lat},${stopPoint.lon}`;
  }

  // Utility method to check if service is good
  isGoodService(lineStatus: LineStatus): boolean {
    return lineStatus.lineStatuses.every(status => status.statusSeverity === 10);
  }

  // Get severity description
  getSeverityDescription(severity: number): string {
    const severityMap: Record<number, string> = {
      0: 'Special Service',
      1: 'Closed',
      2: 'Suspended',
      3: 'Part Suspended',
      4: 'Planned Closure',
      5: 'Part Closure',
      6: 'Severe Delays',
      7: 'Reduced Service',
      8: 'Bus Service',
      9: 'Minor Delays',
      10: 'Good Service',
      11: 'Part Closed',
      12: 'Exit Only',
      13: 'No Step Free Access',
      14: 'Change of frequency',
      15: 'Diverted',
      16: 'Not Running',
      17: 'Issues Reported',
      18: 'No Issues',
      19: 'Information',
      20: 'Service Closed',
    };

    return severityMap[severity] || 'Unknown';
  }
}

// Create and export a singleton instance
export const tflClient = new TFLApiClient();

// Export the class for testing purposes
export { TFLApiClient };
