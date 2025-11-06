"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MapPin, Navigation, Clock, ChevronDown, ChevronUp, ExternalLink, Train, Bus as BusIcon, TramFront, Ship, Footprints, Zap, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useGeolocation } from '@/hooks/useGeolocation';
import { getLineColor, getModeColor, getLineShortLabel } from '@/lib/line-colors';
import { TflBadge } from '@/components/branding/tfl-badge';
import { Input } from '@/components/ui/input';
import { ModeFilter } from '@/components/status/mode-filter';
import {
  ALL_MODE_OPTION,
  MODE_KEYS,
  modeConfig,
  normalizeModeSelection,
  type ModeSelectionValue,
} from '@/lib/mode-config';

type NearbyStation = {
  id: string;
  naptanId: string;
  name: string;
  modes: string[];
  lat: number;
  lon: number;
  zone?: string;
  distance: number;
  distanceFormatted: string;
  lines: Array<{ id: string; name: string }>;
};

type GroupedArrivals = Array<{
  key: string;
  lineName: string;
  platformName: string;
  direction?: string;
  modeName?: string;
  arrivals: Array<{
    id: string;
    destinationName: string;
    expectedArrival: string;
    timeToStation: number;
    currentLocation?: string;
  }>;
}>;

const DEFAULT_RADIUS = 3000;

function formatEta(seconds: number): string {
  if (seconds < 30) return 'due';
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

function googleWalkingUrl(originLat: number, originLon: number, destLat: number, destLon: number): string {
  const base = 'https://www.google.com/maps/dir/?api=1';
  const params = new URLSearchParams({
    origin: `${originLat},${originLon}`,
    destination: `${destLat},${destLon}`,
    travelmode: 'walking',
  });
  return `${base}&${params.toString()}`;
}

export default function NextAvailablePage() {
  const { location, loading: geoLoading, error: geoError, requestLocation, isSupported } = useGeolocation({ autoRequest: true, enableHighAccuracy: true, timeout: 10000 });

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode');

  const [stations, setStations] = useState<NearbyStation[]>([]);
  const [fetchingStations, setFetchingStations] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ModeSelectionValue>(() =>
    normalizeModeSelection(modeParam)
  );
  const [allStations, setAllStations] = useState<NearbyStation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [arrivalsByStation, setArrivalsByStation] = useState<Record<string, GroupedArrivals>>({});
  const [arrivalsLoading, setArrivalsLoading] = useState<Record<string, boolean>>({});
  const [arrivalsError, setArrivalsError] = useState<Record<string, string | null>>({});
  const filtersRef = useRef<{ mode: ModeSelectionValue; search: string }>({
    mode: normalizeModeSelection(modeParam),
    search: '',
  });
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const prevModeParamRef = useRef<string | null>(null);

  const latitude = location?.latitude ?? null;
  const longitude = location?.longitude ?? null;

  const modeOptions = useMemo(
    () => [
      {
        value: ALL_MODE_OPTION.value,
        label: ALL_MODE_OPTION.label,
        icon: ALL_MODE_OPTION.icon,
      },
      ...MODE_KEYS.map((mode) => ({
        value: mode as ModeSelectionValue,
        label: modeConfig[mode].label,
        icon: modeConfig[mode].icon,
      })),
    ],
    []
  );

  const scrollToSearchArea = useCallback(() => {
    if (!searchAreaRef.current) return;
    searchAreaRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const updateModeInUrl = useCallback(
    (mode: ModeSelectionValue) => {
      if (!pathname) return;

      const params = new URLSearchParams(searchParams?.toString() ?? '');

      if (mode === ALL_MODE_OPTION.value) {
        params.delete('mode');
      } else {
        params.set('mode', mode);
      }

      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const normalized = normalizeModeSelection(modeParam);
    if (normalized !== selectedMode) {
      setSelectedMode(normalized);
    }
    filtersRef.current.mode = normalized;

    const previousMode = prevModeParamRef.current;
    const currentMode = modeParam ?? null;
    if (currentMode && previousMode !== currentMode) {
      scrollToSearchArea();
    }
    prevModeParamRef.current = currentMode;
  }, [modeParam, selectedMode, scrollToSearchArea]);

  const handleModeSelect = useCallback(
    (mode: ModeSelectionValue) => {
      if (mode === selectedMode) return;
      setSelectedMode(mode);
      filtersRef.current.mode = mode;
      updateModeInUrl(mode);
      prevModeParamRef.current = mode === ALL_MODE_OPTION.value ? null : mode;
      scrollToSearchArea();
    },
    [selectedMode, updateModeInUrl, scrollToSearchArea]
  );

  const loadStations = useCallback(async (
    options: { showRefreshing?: boolean; clearExisting?: boolean } = {}
  ) => {
    if (latitude == null || longitude == null) {
      return;
    }

    const { showRefreshing = false, clearExisting = false } = options;

    if (showRefreshing) {
      setRefreshing(true);
    }

    setStationsError(null);
    setExpanded({});
    setArrivalsByStation({});
    setArrivalsError({});

    if (clearExisting) {
      setFetchingStations(true);
      setAllStations([]);
      setStations([]);
    }

    try {
      const resp = await fetch('/api/stations/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: latitude,
          lon: longitude,
          radius: DEFAULT_RADIUS,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json.status !== 'success') {
        throw new Error(json.error || 'Failed to fetch nearby stations');
      }
      setAllStations(json.data.stations as NearbyStation[]);
    } catch (e) {
      setStationsError((e as Error).message);
      if (clearExisting) {
        setAllStations([]);
        setStations([]);
      }
    } finally {
      if (clearExisting) {
        setFetchingStations(false);
      }
      if (showRefreshing) {
        setRefreshing(false);
      }
    }
  }, [latitude, longitude]);

  useEffect(() => {
    loadStations({ clearExisting: true });
  }, [loadStations]);

  useEffect(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    let filtered = allStations;

    if (selectedMode !== ALL_MODE_OPTION.value) {
      const selectedModeKey = selectedMode;
      filtered = filtered.filter((station) =>
        station.modes.some((mode) => mode.toLowerCase() === selectedModeKey)
      );
    }

    if (normalizedSearch) {
      filtered = filtered.filter((station) => {
        const name = station.name?.toLowerCase() ?? '';
        const matchesName = name.includes(normalizedSearch);
        const matchesLine = station.lines.some((line) =>
          line.name.toLowerCase().includes(normalizedSearch) ||
          line.id.toLowerCase().includes(normalizedSearch)
        );
        return matchesName || matchesLine;
      });
    }

    setStations(filtered);

    if (
      filtersRef.current.mode !== selectedMode ||
      filtersRef.current.search !== normalizedSearch
    ) {
      setExpanded({});
      setArrivalsByStation({});
      setArrivalsError({});
    }

    filtersRef.current = { mode: selectedMode, search: normalizedSearch };
  }, [selectedMode, allStations, searchQuery]);

  const topStations = useMemo(() => stations.slice(0, 20), [stations]);

  const toggleExpand = async (stationId: string) => {
    const next = !expanded[stationId];
    setExpanded((s) => ({ ...s, [stationId]: next }));
    if (next && !arrivalsByStation[stationId]) {
      setArrivalsLoading((s) => ({ ...s, [stationId]: true }));
      setArrivalsError((s) => ({ ...s, [stationId]: null }));
      try {
        const resp = await fetch(`/api/stations/${encodeURIComponent(stationId)}/arrivals?grouped=true`);
        const json = await resp.json();
        if (!resp.ok || json.status !== 'success') {
          throw new Error(json.error || 'Failed to fetch arrivals');
        }
        setArrivalsByStation((s) => ({ ...s, [stationId]: json.data.grouped as GroupedArrivals }));
      } catch (e) {
        setArrivalsError((s) => ({ ...s, [stationId]: (e as Error).message }));
      } finally {
        setArrivalsLoading((s) => ({ ...s, [stationId]: false }));
      }
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-tfl-green/12 via-transparent to-tfl-blue/12" />
        <div className="container relative py-12 md:py-20">
          <div className="mx-auto max-w-4xl text-center space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-tfl-green shadow-sm">
              <Navigation className="h-4 w-4" aria-hidden="true" />
              Next available departures near you
            </span>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl">
              Find nearby stations and the next departures
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl md:leading-relaxed">
              Discover nearby Tube, bus, and rail stops. Expand a station to see upcoming services by platform, and get walking directions with one tap.
            </p>
          </div>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Button onClick={() => requestLocation()} disabled={geoLoading}>
              <MapPin className="mr-2 h-4 w-4" />
              {geoLoading ? 'Locating…' : 'Use my location'}
            </Button>
            {!isSupported && (
              <span className="text-sm text-destructive">Geolocation is not supported by this browser.</span>
            )}
            {geoError && (
              <span className="text-sm text-destructive">{geoError.message}</span>
            )}
          </div>

          <div
            ref={searchAreaRef}
            className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 scroll-mt-24"
          >
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search stations..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => loadStations({ showRefreshing: true, clearExisting: allStations.length === 0 })}
                disabled={refreshing || latitude == null || longitude == null}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <ModeFilter
            className="mt-8"
            options={modeOptions}
            selected={selectedMode}
            onSelect={handleModeSelect}
            disabled={refreshing && allStations.length === 0}
            description="Focus stations and departures for a specific transport network."
          />

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {fetchingStations && (
              <Card>
                <CardContent className="p-6">Fetching nearby stations…</CardContent>
              </Card>
            )}

            {stationsError && (
              <Card>
                <CardContent className="p-6 text-destructive">{stationsError}</CardContent>
              </Card>
            )}

            {!fetchingStations && !stationsError && topStations.map((s) => {
              const isOpen = !!expanded[s.id];
              const gmaps = location ? googleWalkingUrl(location.latitude, location.longitude, s.lat, s.lon) : undefined;
              return (
                <Card key={s.id} className="overflow-hidden border-gray-200/70 shadow-sm">
                  <CardContent className="p-0">
                    <button
                      className="w-full text-left p-5 hover:bg-gray-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => toggleExpand(s.id)}
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-base font-semibold tracking-tight">{s.name}</div>
                          <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                            <span>{s.distanceFormatted}{s.zone ? ` • Zone ${s.zone}` : ''}</span>
                            <span className="inline-flex items-center gap-1">
                              {s.modes.map((m) => (
                                <ModeBadge key={m} mode={m} />
                              ))}
                            </span>
                          </div>
                          {s.lines?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                              {s.lines.map((l) => (
                                <LineBadge key={l.id} idOrName={l.id || l.name} name={l.name} />
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="ml-4 text-gray-500">
                          {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-5 pb-5 pt-2 border-t">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Upcoming services
                          </div>
                          {gmaps && (
                            <a
                              href={gmaps}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm inline-flex items-center gap-1 text-blue-600 hover:underline"
                            >
                              Walk directions <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>

                        {arrivalsLoading[s.id] && (
                          <div className="text-sm text-muted-foreground">Loading arrivals…</div>
                        )}
                        {arrivalsError[s.id] && (
                          <div className="text-sm text-destructive">{arrivalsError[s.id]}</div>
                        )}

                        {!arrivalsLoading[s.id] && !arrivalsError[s.id] && (arrivalsByStation[s.id]?.length ? (
                          <div className="space-y-4">
                            {arrivalsByStation[s.id].map((g) => {
                              const color = getLineColor(g.lineName, g.modeName);
                              return (
                                <div key={g.key} className="rounded-md border p-3" style={{ borderColor: `${color.background}33` }}>
                                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: color.text }}>
                                    <TflBadge mode={g.modeName} lineIdOrName={g.lineName} size={22} />
                                    <LineBadge idOrName={g.lineName} name={g.lineName} />
                                    <span className="text-gray-700 font-normal">— {g.platformName}{g.direction ? ` (${g.direction.toLowerCase()})` : ''}</span>
                                  </div>
                                  <ul className="space-y-1.5">
                                    {g.arrivals.slice(0, 6).map((a) => (
                                      <li key={a.id} className="flex items-center justify-between text-sm">
                                        <span className="truncate pr-3 text-gray-800">{a.destinationName}</span>
                                        <span className="tabular-nums text-gray-900 font-medium">{formatEta(a.timeToStation)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No upcoming services found.</div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const color = getModeColor(mode);
  const iconClass = "h-3.5 w-3.5";
  const Icon = (() => {
    const m = mode.toLowerCase();
    if (m === 'bus') return BusIcon;
    if (m === 'tram') return TramFront;
    if (m === 'river-bus' || m === 'river' || m === 'waterbus') return Ship;
    if (m === 'cable-car') return Zap;
    if (m === 'walking') return Footprints;
    // tube, dlr, overground, others
    return Train;
  })();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs shadow-sm border"
      style={{ background: `${color.background}0D`, color: color.background, borderColor: `${color.background}33` }}
    >
      <Icon className={iconClass} />
      {mode}
    </span>
  );
}

function LineBadge({ idOrName, name }: { idOrName: string; name: string }) {
  const color = getLineColor(idOrName || name);
  const label = getLineShortLabel(idOrName, name);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 whitespace-nowrap max-w-[140px] truncate"
      style={{ background: color.background, color: color.text }}
      title={name}
    >
      {label}
    </span>
  );
}


