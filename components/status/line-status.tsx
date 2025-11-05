"use client";

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { 
  AlertCircle, 
  CheckCircle, 
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Train,
  Bus,
  TramFront,
  Zap,
  Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLineColor, getModeColor, getLineShortLabel } from '@/lib/line-colors';
import { TflBadge } from '@/components/branding/tfl-badge';

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
}

const modeConfig = {
  tube: { label: 'Underground', icon: Train, color: 'bg-tfl-blue' },
  bus: { label: 'Buses', icon: Bus, color: 'bg-tfl-red' },
  dlr: { label: 'DLR', icon: Train, color: 'bg-teal-600' },
  overground: { label: 'Overground', icon: Train, color: 'bg-orange-600' },
  tram: { label: 'Tram', icon: TramFront, color: 'bg-green-600' },
  'river-bus': { label: 'River Bus', icon: Bus, color: 'bg-blue-600' },
  'cable-car': { label: 'Cable Car', icon: Zap, color: 'bg-purple-600' },
};

export function LineStatus() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusData, setStatusData] = useState<StatusResponseData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const { toast } = useToast();

  // Fetch status data
  const fetchStatus = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    
    try {
      const params = new URLSearchParams();
      if (selectedMode !== 'all') {
        params.append('mode', selectedMode);
      }
      if (searchQuery) {
        params.append('q', searchQuery);
      }

      const response = await fetch(`/api/status?${params}`);
      const data = await response.json();

      if (data.status === 'success') {
        setStatusData(data.data);
        setLastUpdated(new Date());
      } else {
        throw new Error(data.error || 'Failed to fetch status');
      }
    } catch (error) {
      console.error('Status fetch error:', error);
      toast({
        title: "Error fetching status",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedMode, searchQuery, toast]);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Get status icon and color
  const getStatusIcon = (severity: number) => {
    if (severity >= 10) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    } else if (severity >= 6) {
      return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
    } else if (severity >= 3) {
      return <AlertCircle className="h-5 w-5 text-orange-600" />;
    } else {
      return <XCircle className="h-5 w-5 text-red-600" />;
    }
  };

  const getSeverityColor = (severity: number) => {
    if (severity >= 10) return 'border-green-600';
    if (severity >= 6) return 'border-yellow-600';
    if (severity >= 3) return 'border-orange-600';
    return 'border-red-600';
  };

  // Render line status card
  const matchedLineIds = new Set(statusData?.matchedLineIds ?? []);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const shouldUseMatchedResults = normalizedSearchQuery.length > 0 && matchedLineIds.size > 0;

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
                <div className="flex items-center gap-2 flex-wrap">
                  {getStatusIcon(line.severity)}
                  <LineBadge idOrName={line.id} name={line.name} />
                </div>
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
            onClick={() => fetchStatus(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Mode tabs */}
      <Tabs value={selectedMode} onValueChange={setSelectedMode} className="w-full">
        <TabsList
          className="w-full h-auto gap-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8"
          style={{ display: 'grid' }}
        >
          <TabsTrigger value="all" className="group flex w-full items-center justify-center gap-2 py-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground/70">
              <Layers className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="hidden sm:inline">All</span>
          </TabsTrigger>
          {Object.entries(modeConfig).map(([key, config]) => {
            const color = getModeColor(key);
            return (
              <TabsTrigger key={key} value={key} className="group flex w-full items-center justify-center gap-2 py-2">
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border"
                  style={{ background: `${color.background}0D`, color: color.background, borderColor: `${color.background}33` }}
                  title={config.label}
                >
                  <config.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="hidden sm:inline">{config.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={selectedMode} className="mt-6">
          {/* Overall status summary */}
          {statusData?.modes && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
              {statusData.modes
                .filter((mode: ModeStatus) => selectedMode === 'all' || mode.mode === selectedMode)
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
                          <div className={cn(
                            "h-3 w-3 rounded-full",
                            mode.overallStatus === 'good' ? 'bg-green-600' : 'bg-red-600'
                          )} />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          {mode.affectedLines.length === 0 
                            ? `All ${mode.totalLines} lines running well`
                            : `${mode.affectedLines.length} of ${mode.totalLines} lines affected`
                          }
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}

          {/* Line details */}
          {statusData?.lines && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Line Details</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {statusData.lines
                  .filter((line: LineStatusData) => {
                    if (selectedMode !== 'all' && line.modeName !== selectedMode) {
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
            </div>
          )}
        </TabsContent>
      </Tabs>
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
