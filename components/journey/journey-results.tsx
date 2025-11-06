"use client";

import { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Footprints,
  Train,
  Bus,
  TramFront,
  AlertCircle,
  Accessibility,
  ArrowUpRight,
  Clock,
  Route,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLineColor, getModeColor, getLineShortLabel } from '@/lib/line-colors';
import { TflBadge } from '@/components/branding/tfl-badge';

interface JourneyResultsProps {
  journeys: any[];
  fromName?: string;
  toName?: string;
  onClose?: () => void;
  onSelectJourney?: (journey: any) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const modeIcons: Record<string, LucideIcon> = {
  walking: Footprints,
  tube: Train,
  bus: Bus,
  dlr: Train,
  overground: Train,
  tram: TramFront,
  'national-rail': Train,
  'river-bus': Bus,
};

export function JourneyResults({
  journeys,
  fromName,
  toName,
  onClose,
  onSelectJourney,
  onRefresh,
  refreshing,
}: JourneyResultsProps) {
  // Auto-refresh next departures every 15 seconds
  useEffect(() => {
    if (!onRefresh) return;
    const intervalId = setInterval(() => {
      // Avoid firing when tab is hidden and avoid overlapping refreshes
      if (typeof document !== 'undefined' && (document as any).hidden) return;
      if (!refreshing) {
        onRefresh();
      }
    }, 15000);

    return () => clearInterval(intervalId);
  }, [onRefresh, refreshing]);

  // Format duration
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  // Format time
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatMinutesFromSeconds = (seconds: number): string => {
    if (typeof seconds !== 'number') return '';
    return `${Math.max(0, Math.round(seconds / 60))} min`;
  };

  const simpleMarkdownToRichText = (text: string) => {
    if (!text) return '';

    const escapeHtml = (unsafe: string) =>
      unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // Escape HTML first, then apply minimal markdown replacements
    let html = escapeHtml(text);

    // Bold+italic (triple markers) first to avoid leaving stray *
    html = html
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links [text](url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');

    return html;
  };

  const renderAccessibleDescription = (description: string) => {
    const rawLines = description.split(/\r?\n/);
    const lines = rawLines.map((line) => line.trim()).filter(Boolean);

    if (lines.length === 0) {
      return null;
    }

    const content: Array<JSX.Element> = [];
    let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

    const flushList = () => {
      if (!currentList || currentList.items.length === 0) return;

      if (currentList.type === 'ul') {
        content.push(
          <ul key={`ul-${content.length}`} className="ml-4 list-disc space-y-1 text-sm leading-relaxed">
            {currentList.items.map((item, idx) => (
              <li
                key={`ul-item-${content.length}-${idx}`}
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToRichText(item) }}
              />
            ))}
          </ul>
        );
      } else {
        content.push(
          <ol key={`ol-${content.length}`} className="ml-4 list-decimal space-y-1 text-sm leading-relaxed">
            {currentList.items.map((item, idx) => (
              <li
                key={`ol-item-${content.length}-${idx}`}
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToRichText(item) }}
              />
            ))}
          </ol>
        );
      }

      currentList = null;
    };

    lines.forEach((line) => {
      if (/^---+$/.test(line)) {
        flushList();
        content.push(<hr key={`hr-${content.length}`} className="my-3 border-muted" />);
        return;
      }

      const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const HeadingTag = (`h${Math.min(6, level + 1)}` as keyof JSX.IntrinsicElements);
        content.push(
          <HeadingTag key={`heading-${content.length}`} className="text-sm font-semibold text-foreground">
            {text}
          </HeadingTag>
        );
        return;
      }

      const orderedMatch = line.match(/^\d+[\.)]\s+(.+)$/);
      if (orderedMatch) {
        const text = orderedMatch[1].trim();
        if (!currentList || currentList.type !== 'ol') {
          flushList();
          currentList = { type: 'ol', items: [] };
        }
        currentList.items.push(text);
        return;
      }

      const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
      if (unorderedMatch) {
        const text = unorderedMatch[1].trim();
        if (!currentList || currentList.type !== 'ul') {
          flushList();
          currentList = { type: 'ul', items: [] };
        }
        currentList.items.push(text);
        return;
      }

      const strongOnlyMatch = line.match(/^\*\*(.+)\*\*$/);
      if (strongOnlyMatch) {
        flushList();
        content.push(
          <p
            key={`strong-${content.length}`}
            className="text-base font-semibold text-foreground"
          >
            {strongOnlyMatch[1]}
          </p>
        );
        return;
      }

      flushList();

      content.push(
        <p
          key={`paragraph-${content.length}`}
          className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: simpleMarkdownToRichText(line) }}
        />
      );
    });

    flushList();

    return (
      <div className="mt-4 rounded-lg border border-muted-foreground/20 bg-muted/40 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Journey Description</p>
        <div className="space-y-2">{content}</div>
      </div>
    );
  };

  const renderLegSummary = (leg: any, index: number, totalLegs: number) => {
    const mode = leg.mode.id;
    const IconComponent = modeIcons[mode] || Train;
    const routeOption = leg.routeOptions?.[0];
    const rawLineIdentifier = routeOption?.lineIdentifier?.id || routeOption?.name || leg.mode.name;
    const enhancements = leg.enhancements || {};
    const isWalking = mode === 'walking';

    const iconColors = (() => {
      if (isWalking) {
        const walkingColor = getModeColor(mode);
        return walkingColor;
      }
      return getLineColor(rawLineIdentifier, mode);
    })();

    const nextArrivals = (enhancements.nextArrivals || []) as Array<{
      id: string;
      destinationName: string;
      expectedArrival: string;
      timeToStation: number;
      platformName?: string;
      towards?: string;
    }>;

    const durationLabel = formatDuration(leg.duration);

    const modeLabel = isWalking ? 'Walking segment' : `${routeOption?.name || leg.mode.name} segment`;

    const renderLineGlyph = () => {
      if (isWalking) {
        return (
          <div
            className="relative flex h-11 w-11 items-center justify-center rounded-full bg-muted"
            role="presentation"
            aria-hidden="true"
          >
            <IconComponent className="h-5 w-5 text-foreground" />
          </div>
        );
      }

      return (
        <TflBadge
          mode={mode}
          lineIdOrName={rawLineIdentifier}
          size={44}
          ariaLabel={`${routeOption?.name || leg.mode.name} glyph`}
        />
      );
    };

    return (
      <article
        className="relative pl-8 focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
        role="listitem"
        aria-label={modeLabel}
      >
        {index < totalLegs - 1 && (
          <span className="absolute left-[19px] top-12 h-full w-px bg-muted" aria-hidden="true" />
        )}

        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center" aria-hidden="true">
              {renderLineGlyph()}
            </div>

            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold capitalize">
                    {isWalking ? `Walk ${durationLabel}` : routeOption?.name || leg.mode.name}
                  </p>
                  {!isWalking && (
                    <LineBadge idOrName={rawLineIdentifier} name={routeOption?.name || leg.mode.name} />
                  )}
                </div>
                {!isWalking && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Clock className="mr-1 h-3 w-3" />
                    {durationLabel}
                  </span>
                )}
              </div>

              {!isWalking && (routeOption?.directions?.[0] || leg.instruction?.summary) && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Route className="inline-block h-3 w-3" aria-hidden="true" />
                  <span>{routeOption?.directions?.[0] || leg.instruction?.summary}</span>
                </p>
              )}

              {!isWalking && leg.departureTime && leg.arrivalTime && (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Departs {formatTime(leg.departureTime)}</span>
                  <span>Arrives {formatTime(leg.arrivalTime)}</span>
                </div>
              )}

              {isWalking && leg.departureTime && leg.arrivalTime && (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Starts {formatTime(leg.departureTime)}</span>
                  <span>Ends {formatTime(leg.arrivalTime)}</span>
                </div>
              )}

              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="space-y-1">
                  {enhancements.fromName && (
                    <p>
                      <span className="font-medium">From:</span> {enhancements.fromName}
                      {!isWalking && enhancements.platformName && (
                        <span className="block text-xs text-muted-foreground">
                          Platform {enhancements.platformName}
                        </span>
                      )}
                    </p>
                  )}
                  {enhancements.toName && (
                    <p>
                      <span className="font-medium">To:</span> {enhancements.toName}
                    </p>
                  )}
                  {isWalking && enhancements.distanceSummary && (
                    <p className="text-xs text-muted-foreground">Distance: {enhancements.distanceSummary}</p>
                  )}
                </div>

                <div className="space-y-2">
                  {isWalking && enhancements.googleMapsUrl && (
                    <Button
                      variant="link"
                      size="sm"
                      className="px-0 h-auto w-full whitespace-normal break-words text-left justify-start gap-1 items-start sm:w-auto"
                      asChild
                    >
                      <a href={enhancements.googleMapsUrl} target="_blank" rel="noopener noreferrer">
                        <span className="inline">Open directions in Google Maps</span>
                        <ArrowUpRight className="inline ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  {!isWalking && !nextArrivals.length && (
                    <p className="text-xs text-muted-foreground">
                      Live departure information unavailable.
                    </p>
                  )}
                </div>
              </div>

              {!isWalking && nextArrivals.length > 0 && (
                <div className="space-y-2" aria-live="polite">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Next departures</p>
                  <ul className="space-y-2" role="list">
                    {nextArrivals.map((arrival) => (
                      <li
                        key={arrival.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs"
                        role="listitem"
                        aria-label={`Train towards ${arrival.destinationName} arriving in ${formatMinutesFromSeconds(arrival.timeToStation)}`}
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">
                            {formatMinutesFromSeconds(arrival.timeToStation)} • {formatTime(arrival.expectedArrival)}
                          </span>
                          <span className="text-muted-foreground">
                            towards {arrival.destinationName}
                          </span>
                        </div>
                        {arrival.towards && (
                          <span className="text-muted-foreground">{arrival.towards}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  };

  // Render journey card
  const renderJourneyCard = (journey: any, index: number) => {
    const departureTime = new Date(journey.startDateTime);
    const arrivalTime = new Date(journey.arrivalDateTime);
    const now = new Date();
    const minutesUntilDeparture = Math.floor((departureTime.getTime() - now.getTime()) / 60000);
    const originName = journey.legs?.[0]?.departurePoint?.commonName || fromName || 'Start';
    const destinationName =
      journey.legs?.[journey.legs.length - 1]?.arrivalPoint?.commonName || toName || 'Destination';

    return (
      <Card 
        key={index} 
        className="cursor-pointer hover:shadow-xl transition-all border-2 hover:border-tfl-blue/50"
        onClick={() => onSelectJourney?.(journey)}
      >
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="text-xl">
                {formatTime(journey.startDateTime)} - {formatTime(journey.arrivalDateTime)}
              </CardTitle>
              <CardDescription className="text-base">
                Duration: <span className="font-semibold">{formatDuration(journey.duration)}</span>
                {journey.fare && (
                  <span className="ml-3 font-semibold text-foreground">
                    £{(journey.fare.totalCost / 100).toFixed(2)}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="text-right">
              {minutesUntilDeparture > 0 && minutesUntilDeparture < 60 && (
                <span className="text-base text-orange-600 font-semibold px-3 py-1 bg-orange-50 dark:bg-orange-900/20 rounded-full">
                  Departs in {minutesUntilDeparture} min
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-5">
          {/* Journey legs */}
          <div
            className="space-y-5"
            role="list"
            aria-label={`Journey steps from ${originName} to ${destinationName}`}
          >
            {journey.legs.map((leg: any, legIndex: number) =>
              renderLegSummary(leg, legIndex, journey.legs.length)
            )}
          </div>

          {/* Disruptions */}
          {journey.legs.some((leg: any) => leg.disruptions?.length > 0) && (
            <div className="mt-3 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-center">
                <AlertCircle className="h-4 w-4 mr-1" />
                Service disruptions on this route
              </p>
            </div>
          )}

          {/* Accessibility info */}
          {journey.accessibleDescription && (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-200">
                <Accessibility className="h-4 w-4" />
                Accessible Guidance
              </div>
              {renderAccessibleDescription(journey.accessibleDescription)}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (!journeys || journeys.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No journeys found</CardTitle>
          <CardDescription>
            We couldn't find any routes for your journey. Please try different stations or check service status.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold mb-2">Journey Options</h3>
          {fromName && toName && (
            <p className="text-base text-muted-foreground flex items-center gap-2">
              <span className="font-medium">{fromName}</span>
              <ArrowRight className="h-4 w-4" />
              <span className="font-medium">{toName}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh journey"
            >
              <RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} aria-hidden="true" />
              <span className="sr-only">Refresh journey results</span>
            </Button>
          )}
          {onClose && (
            <Button variant="outline" size="lg" onClick={onClose} className="h-12 px-6">
              New search
            </Button>
          )}
        </div>
      </div>

      {/* Journey cards */}
      <div className="space-y-3">
        {journeys.slice(0, 3).map((journey, index) => renderJourneyCard(journey, index))}
      </div>

      {/* More options */}
      {journeys.length > 3 && (
        <div className="text-center pt-2">
          <Button variant="outline" size="lg" className="h-12 px-6">
            Show {journeys.length - 3} more options
          </Button>
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
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap max-w-[140px] truncate"
      style={{ background: color.background, color: color.text }}
      title={name}
    >
      {label}
    </span>
  );
}
