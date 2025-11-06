"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Search, Train } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLineColor, getModeColor, getLineShortLabel } from '@/lib/line-colors';
import { TflBadge } from '@/components/branding/tfl-badge';
import {
  ALL_MODE_OPTION,
  MODE_KEYS,
  normalizeModeSelection,
  type ModeSelectionValue,
  modeConfig,
} from '@/lib/mode-config';
import { ModeFilter } from '@/components/status/mode-filter';

interface LineStatusData {
  id: string;
  name: string;
  modeName: string;
  severity: number;
  severityDescription: string;
  reason?: string;
  isGoodService: boolean;
  disruptions: any[];
  upcomingArrivals?: Array<{
    stationName: string;
    destinationName: string;
    expectedArrival: string;
    timeToStation: number;
  }>;
}

interface ModeStatus {
  mode: string;
  overallStatus: string;
  severity: number;
  affectedLines: string[];
  totalLines: number;
}

interface StatusResponseData {
  lastUpdated: string;
  query?: string;
  modes: ModeStatus[];
  lines: LineStatusData[];
  groupedByMode: Record<string, LineStatusData[]>;
  matchedLineIds?: string[];
  totalLineCount: number;
  pagination: {
    offset: number;
    limit: number;
    returned: number;
  };
}

interface LineStatusProps {
  defaultMode?: string | null;
}

type FetchOptions = {
  showRefreshing?: boolean;
  modeOverride?: ModeSelectionValue;
  queryOverride?: string;
  append?: boolean;
  offsetOverride?: number;
  limitOverride?: number;
  reset?: boolean;
};

const DEFAULT_PAGE_SIZE = 10;

export function LineStatus({ defaultMode }: LineStatusProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const normalizedDefaultMode = useMemo(() => normalizeModeSelection(defaultMode), [defaultMode]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusData, setStatusData] = useState<StatusResponseData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState<ModeSelectionValue>(normalizedDefaultMode);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  
  const { toast } = useToast();

  const selectedModeRef = useRef<ModeSelectionValue>(normalizedDefaultMode);
  const searchQueryRef = useRef('');
  const linesRef = useRef<LineStatusData[]>([]);

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
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, router, searchParams]
  );

  // Fetch status data
  const fetchStatus = useCallback(
    async ({
      showRefreshing = false,
      modeOverride,
      queryOverride,
      append = false,
      offsetOverride,
      limitOverride,
      reset = false,
    }: FetchOptions = {}) => {
      const modeForRequest = modeOverride ?? selectedModeRef.current;
      const queryForRequest = queryOverride ?? searchQueryRef.current;

      if (reset) {
        linesRef.current = [];
        setStatusData((prev) => (prev ? { ...prev, lines: [] } : prev));
      }

      const previousLines = linesRef.current;
      const calculatedOffset = append
        ? offsetOverride ?? previousLines.length
        : reset
        ? 0
        : offsetOverride ?? 0;
      const minimumLimit = previousLines.length > 0 ? previousLines.length : DEFAULT_PAGE_SIZE;
      const calculatedLimit = append
        ? limitOverride ?? DEFAULT_PAGE_SIZE
        : reset
        ? limitOverride ?? DEFAULT_PAGE_SIZE
        : limitOverride ?? minimumLimit;

      if (!hasLoadedOnce) {
        setLoading(true);
      } else if (append) {
        setLoadingMore(true);
      } else if (showRefreshing || modeOverride || queryOverride !== undefined || reset) {
        setRefreshing(true);
      }

    try {
      const params = new URLSearchParams();
        if (queryForRequest) {
          params.set('q', queryForRequest);
        }

        if (modeForRequest && modeForRequest !== ALL_MODE_OPTION.value) {
          params.set('mode', modeForRequest);
        }

        const safeLimit = Math.max(1, calculatedLimit);
        params.set('limit', safeLimit.toString());

        if (calculatedOffset > 0) {
          params.set('offset', Math.max(0, calculatedOffset).toString());
        }

      const queryString = params.toString();
      const url = queryString ? `/api/status?${queryString}` : '/api/status';

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'success') {
          const incomingLines: LineStatusData[] = data.data.lines ?? [];
          const combinedLines = append
            ? (() => {
                const seen = new Set<string>();
                return [...previousLines, ...incomingLines].filter((line) => {
                  if (seen.has(line.id)) {
                    return false;
                  }
                  seen.add(line.id);
                  return true;
                });
              })()
            : incomingLines;

          linesRef.current = combinedLines;

          setStatusData({
            ...data.data,
            lines: combinedLines,
          });
        setLastUpdated(new Date());
          if (!hasLoadedOnce) {
            setHasLoadedOnce(true);
          }
      } else {
        throw new Error(data.error || 'Failed to fetch status');
      }
    } catch (error) {
      console.error('Status fetch error:', error);
      toast({
          title: 'Error fetching status',
          description: error instanceof Error ? error.message : 'Please try again',
          variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
    },
    [hasLoadedOnce, toast]
  );

  // Initial load
  useEffect(() => {
    fetchStatus({ reset: true });
  }, [fetchStatus]);

  // Keep refs in sync
  useEffect(() => {
    selectedModeRef.current = selectedMode;
  }, [selectedMode]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  // React to default mode changes from URL navigation
  useEffect(() => {
    if (selectedModeRef.current === normalizedDefaultMode) {
      return;
    }

    selectedModeRef.current = normalizedDefaultMode;
    setSelectedMode(normalizedDefaultMode);

    fetchStatus({ showRefreshing: hasLoadedOnce, modeOverride: normalizedDefaultMode, reset: true });
  }, [normalizedDefaultMode, fetchStatus, hasLoadedOnce]);

  // Debounced search updates
  useEffect(() => {
    if (!hasLoadedOnce) return;

    const handle = window.setTimeout(() => {
      fetchStatus({ showRefreshing: true, reset: true });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [searchQuery, fetchStatus, hasLoadedOnce]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = window.setInterval(() => {
      fetchStatus({ showRefreshing: true });
    }, 30000);

    return () => window.clearInterval(interval);
  }, [fetchStatus]);

  const getSeverityColor = (severity: number) => {
    if (severity >= 10) return 'border-green-600';
    if (severity >= 6) return 'border-yellow-600';
    if (severity >= 3) return 'border-orange-600';
    return 'border-red-600';
  };

  // Render line status card
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

  const matchedLineIds = new Set(statusData?.matchedLineIds ?? []);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const shouldUseMatchedResults = normalizedSearchQuery.length > 0 && matchedLineIds.size > 0;
  const totalLineCount = statusData?.totalLineCount ?? 0;
  const loadedLineCount = statusData?.lines.length ?? 0;
  const hasMore = loadedLineCount < totalLineCount;

  const handleModeChange = useCallback(
    (mode: ModeSelectionValue) => {
      if (mode === selectedModeRef.current) return;

      selectedModeRef.current = mode;
      setSelectedMode(mode);
      updateModeInUrl(mode);

      fetchStatus({ showRefreshing: hasLoadedOnce, modeOverride: mode, reset: true });
    },
    [fetchStatus, hasLoadedOnce, updateModeInUrl]
  );

  const renderLineCard = (line: LineStatusData) => {
    const ModeIcon = modeConfig[line.modeName as keyof typeof modeConfig]?.icon || Train;
    const lineColor = getLineColor(line.id, line.modeName);
    const upcoming = line.upcomingArrivals ?? [];
    const isMatched = matchedLineIds.has(line.id);
    const badgeAria = `${line.name} ${line.modeName}`;

    return (
      <Card
        key={line.id}
        className={cn(
          'transition-all hover:shadow-md',
          getSeverityColor(line.severity),
          isMatched && 'ring-2 ring-offset-2 ring-primary/40'
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center shrink-0" aria-hidden="false">
                <TflBadge mode={line.modeName} lineIdOrName={line.id} size={32} ariaLabel={badgeAria} />
              </div>
              <div>
                <LineBadge idOrName={line.id} name={line.name} />
                <p className="text-xs text-muted-foreground capitalize">
                  {modeConfig[line.modeName as keyof typeof modeConfig]?.label || line.modeName}
                </p>
              </div>
            </div>
            <SeverityTag severity={line.severity} label={line.severityDescription} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {line.reason && <p className="text-sm text-muted-foreground">{line.reason}</p>}

          {line.disruptions.length > 0 && (
            <div className="space-y-2">
              {line.disruptions.map((disruption: any, index: number) => (
                <div key={index} className="rounded bg-muted p-2 text-sm">
                  <p className="font-medium">{disruption.category}</p>
                  <p className="text-muted-foreground">{disruption.description}</p>
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Next services</p>
            {upcoming.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {upcoming.map((arrival, index) => {
                  const minutes = Math.max(0, Math.round(arrival.timeToStation / 60));
                  const formattedTime = new Date(arrival.expectedArrival).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <li key={`${line.id}-arrival-${index}`} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{minutes} min</span>
                        <span className="ml-2 text-muted-foreground">{arrival.stationName}</span>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <span className="block">{formattedTime}</span>
                        <span className="block">to {arrival.destinationName}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Live schedules unavailable.</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">Loading service status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Service Status</h2>
          {lastUpdated && (
            <p className="text-sm text-muted-foreground">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search lines..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[200px]"
            />
          </div>
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchStatus({ showRefreshing: true })}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ModeFilter
        options={modeOptions}
        selected={selectedMode}
        onSelect={handleModeChange}
        disabled={(refreshing && hasLoadedOnce) || loadingMore}
      />

          {statusData?.modes && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {statusData.modes
            .filter((mode: ModeStatus) => selectedMode === ALL_MODE_OPTION.value || mode.mode === selectedMode)
                .map((mode: ModeStatus) => {
                  const config = modeConfig[mode.mode as keyof typeof modeConfig];
                  if (!config) return null;
                  
                  return (
                    <Card key={mode.mode}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <ModeBadge mode={mode.mode} label={config.label} />
                          </div>
                      <div
                        className={cn(
                          'h-3 w-3 rounded-full',
                            mode.overallStatus === 'good' ? 'bg-green-600' : 'bg-red-600'
                        )}
                      />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          {mode.affectedLines.length === 0 
                            ? `All ${mode.totalLines} lines running well`
                        : `${mode.affectedLines.length} of ${mode.totalLines} lines affected`}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}

          {statusData?.lines && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Line Details</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {statusData.lines
                  .filter((line: LineStatusData) => {
                if (selectedMode !== ALL_MODE_OPTION.value && line.modeName !== selectedMode) {
                      return false;
                    }

                    if (normalizedSearchQuery.length === 0) {
                      return true;
                    }

                    if (shouldUseMatchedResults) {
                      return matchedLineIds.has(line.id);
                    }

                    const normalizedName = line.name.toLowerCase();
                    return (
                      normalizedName.includes(normalizedSearchQuery) ||
                      `${normalizedName} line`.includes(normalizedSearchQuery)
                    );
                  })
                  .map(renderLineCard)}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button onClick={() => fetchStatus({ append: true })} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </div>
          )}
    </div>
  );
}

function LineBadge({ idOrName, name }: { idOrName: string; name: string }) {
  const color = getLineColor(idOrName || name);
  const label = getLineShortLabel(idOrName, name);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-sm leading-none whitespace-nowrap max-w-[160px] truncate"
      style={{ background: color.background, color: color.text }}
      title={name}
    >
      {label}
    </span>
  );
}

function ModeBadge({ mode, label }: { mode: string; label?: string }) {
  const color = getModeColor(mode);
  const Icon = modeConfig[mode as keyof typeof modeConfig]?.icon || Train;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm border leading-none"
      style={{ background: `${color.background}0D`, color: color.background, borderColor: `${color.background}33` }}
      title={label || mode}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label || mode}</span>
    </span>
  );
}

function SeverityTag({ severity, label }: { severity: number; label: string }) {
  // Map TFL severity codes to chip colors
  // 10: Good Service (green)
  // 7-9: Minor to Reduced/Bus service (amber)
  // 4-6: Part closure/severe delays (orange)
  // <=3: Suspended/Closed (red)
  let bg = 'bg-green-100';
  let fg = 'text-green-800';
  let border = 'border-green-200';

  if (severity < 10) {
    if (severity >= 7) {
      bg = 'bg-amber-100';
      fg = 'text-amber-900';
      border = 'border-amber-200';
    } else if (severity >= 4) {
      bg = 'bg-orange-100';
      fg = 'text-orange-900';
      border = 'border-orange-200';
    } else {
      bg = 'bg-red-100';
      fg = 'text-red-800';
      border = 'border-red-200';
    }
  }

  return (
    <span className={cn('text-xs px-2.5 py-1 rounded-full border leading-none', bg, fg, border)}>{label}</span>
  );
}
