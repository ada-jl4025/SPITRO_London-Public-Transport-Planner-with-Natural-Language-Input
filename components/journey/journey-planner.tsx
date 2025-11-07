"use client";

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useGeolocation } from '@/hooks/useGeolocation';
import { StationSelector } from './station-selector';
import { LocationPermission } from './location-permission';
import { JourneyResults } from './journey-results';
import { MapPin, Mic, MicOff, Send, Loader2, ArrowRight } from 'lucide-react';
import type { UIState, JourneySearchParams, TransportMode } from '@/types';

const MAX_RECENT_HISTORY_ITEMS = 15;

export function JourneyPlanner() {
  const [uiState, setUiState] = useState<UIState>({
    inputMode: 'natural-language',
    isLoading: false,
    showLocationPermission: false,
  });
  
  const [naturalLanguageQuery, setNaturalLanguageQuery] = useState('');
  const [manualFrom, setManualFrom] = useState('');
  const [manualTo, setManualTo] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isRefreshingJourney, setIsRefreshingJourney] = useState(false);
  const [isRefreshingLive, setIsRefreshingLive] = useState(false);
  const [showLocationPermission, setShowLocationPermission] = useState(false);
  const [journeyResults, setJourneyResults] = useState<any>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const isManualMode = uiState.inputMode === 'manual-selection';

  // Rotating placeholder examples for supported instructions
  const EXAMPLE_PLACEHOLDERS: string[] = [
    "From Paddington to King's Cross",
    'From Stratford to Waterloo via London Bridge',
    'Step-free to platform from Victoria to Westminster',
    'Step-free to vehicle from Euston to Bank',
    'Tube only from Canary Wharf to Oxford Circus',
    'Bus and DLR only from Greenwich to Lewisham',
    'National Rail from Clapham Junction to Waterloo',
    'Walking only from Hammersmith to Shepherd\'s Bush',
    'Overground and tube only from Whitechapel to Canada Water',
    'From Holborn to Liverpool Street via Farringdon',
  ];
  const [displayExampleIdx, setDisplayExampleIdx] = useState<number>(0);
  const [exampleFading, setExampleFading] = useState<boolean>(false);
  useEffect(() => {
    if (uiState.inputMode !== 'natural-language') return;
    if (naturalLanguageQuery.trim()) return; // Only rotate when empty
    const intervalId = setInterval(() => {
      setExampleFading(true);
      const timeoutId = setTimeout(() => {
        setDisplayExampleIdx((i) => (i + 1) % EXAMPLE_PLACEHOLDERS.length);
        setExampleFading(false);
      }, 250);
      // ensure timeout cleared if unmounted before it fires
      return () => clearTimeout(timeoutId);
    }, 4000);
    return () => clearInterval(intervalId);
  }, [uiState.inputMode, naturalLanguageQuery]);

  // Recent search history (localStorage)
  const [recentNlQueries, setRecentNlQueries] = useState<string[]>([]);
  const [recentManualPairs, setRecentManualPairs] = useState<Array<{ from: string; to: string }>>([]);

  const { toast } = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingParamsRef = useRef<JourneySearchParams | null>(null);
  const lastSearchParamsRef = useRef<JourneySearchParams | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const ensureLocation = async (maxAttempts: number = 3) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const resolved = await requestLocation();
      if (resolved) {
        return resolved;
      }

      if (permissionState.denied) {
        break;
      }

      await sleep(1000);
    }

    return null;
  };
  
  // Geolocation hook
  const { 
    location, 
    error: locationError, 
    loading: locationLoading,
    permissionState,
    requestLocation,
    isSupported: isLocationSupported 
  } = useGeolocation({ autoRequest: false });

  // Handle form submission
  const executeJourney = async (params: JourneySearchParams, isRetry = false): Promise<void> => {
    if (!isRetry) {
      setUiState(prev => ({ ...prev, isLoading: true }));
    }

    try {
      const response = await fetch('/api/journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data?.error === 'location_required') {
          setUiState(prev => ({ ...prev, isLoading: false }));
          pendingParamsRef.current = params;
          setShowLocationPermission(true);
          toast({
            title: 'Location required',
            description: 'We need your current location or a starting station to plan this journey.',
          });

          const resolvedLocation = await ensureLocation();

          if (resolvedLocation) {
            setShowLocationPermission(false);
            const nextParams: JourneySearchParams = {
              ...params,
              from: params.from || `${resolvedLocation.latitude},${resolvedLocation.longitude}`,
            };

            if (isManualMode && !params.from) {
              setManualFrom('Current location');
            }

            pendingParamsRef.current = null;
            setUiState(prev => ({ ...prev, isLoading: true }));
            await executeJourney(nextParams, true);
            setUiState(prev => ({ ...prev, isLoading: false }));
          } else {
            toast({
              title: 'Location still required',
              description: 'Please share your location or enter a starting station.',
              variant: 'destructive',
            });
          }

          return;
        }

        throw new Error(data.error || 'Failed to plan journey');
      }

      setJourneyResults(data.data);
      lastSearchParamsRef.current = params;
      // Persist successful search to history (only on first try)
      if (!isRetry) {
        if (uiState.inputMode === 'natural-language' && params.naturalLanguageQuery) {
          const q = params.naturalLanguageQuery.trim();
          if (q) {
            setRecentNlQueries(prev => {
              const next = [q, ...prev.filter(item => item.toLowerCase() !== q.toLowerCase())]
                .slice(0, MAX_RECENT_HISTORY_ITEMS);
              try {
                localStorage.setItem('journeySearchHistory:nl', JSON.stringify(next));
              } catch {}
              return next;
            });
          }
        } else if (uiState.inputMode === 'manual-selection') {
          const from = (params.from || '').trim();
          const to = (params.to || '').trim();
          if (to) {
            setRecentManualPairs(prev => {
              const key = (p: { from: string; to: string }) => `${(p.from || '').toLowerCase()}->${p.to.toLowerCase()}`;
              const next = [{ from, to }, ...prev.filter(p => key(p) !== key({ from, to }))]
                .slice(0, MAX_RECENT_HISTORY_ITEMS);
              try {
                localStorage.setItem('journeySearchHistory:manual', JSON.stringify(next));
              } catch {}
              return next;
            });
          }
        }
      }
      toast({
        title: 'Journey planned!',
        description: 'Your route has been calculated',
      });
    } catch (error) {
      console.error('Journey planning error:', error);
      toast({
        title: 'Error planning journey',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      if (!isRetry) {
        setUiState(prev => ({ ...prev, isLoading: false }));
      }
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (uiState.inputMode === 'natural-language' && !naturalLanguageQuery.trim()) {
      toast({
        title: 'Please enter your journey',
        description: 'Tell us where you want to go',
        variant: 'destructive',
      });
      return;
    }
    
    if (uiState.inputMode === 'manual-selection' && !manualTo.trim()) {
      toast({
        title: 'Missing information',
        description: 'Please select your destination',
        variant: 'destructive',
      });
      return;
    }

    let searchParams: JourneySearchParams =
      uiState.inputMode === 'natural-language'
        ? { naturalLanguageQuery }
        : { from: manualFrom, to: manualTo };

    const modes: TransportMode[] = ['tube', 'bus', 'dlr', 'overground', 'walking', 'national-rail'];
    searchParams.preferences = {
      ...searchParams.preferences,
      modes,
    };

    if (isManualMode && !searchParams.from && location) {
      searchParams.from = `${location.latitude},${location.longitude}`;
      setManualFrom('Current location');
    }

    pendingParamsRef.current = null;
    await executeJourney(searchParams);
  };

  const handleJourneyRefresh = async () => {
    if (!lastSearchParamsRef.current) {
      return;
    }

    setIsRefreshingJourney(true);
    try {
      await executeJourney(lastSearchParamsRef.current, true);
    } finally {
      setIsRefreshingJourney(false);
    }
  };

  const refreshLiveDepartures = async () => {
    if (!journeyResults) return;
    if (isRefreshingLive) return;

    const journeys: any[] = Array.isArray(journeyResults.journeys) ? journeyResults.journeys : [];
    const legsPayload: any[] = [];

    for (let ji = 0; ji < journeys.length; ji++) {
      const j = journeys[ji];
      const legs: any[] = Array.isArray(j?.legs) ? j.legs : [];
      for (let li = 0; li < legs.length; li++) {
        const leg = legs[li];
        if (!leg || !leg.mode) continue;
        if (leg.mode.id === 'walking') continue;

        const dep = leg.departurePoint || {};
        const arr = leg.arrivalPoint || {};
        const routeOption = Array.isArray(leg.routeOptions) ? leg.routeOptions[0] : undefined;
        const lineId = routeOption?.lineIdentifier?.id || undefined;
        const stopPointId = dep.naptanId || dep.id || undefined;
        const parentStationId = dep.stationNaptan || undefined;

        legsPayload.push({
          journeyIndex: ji,
          legIndex: li,
          modeId: leg.mode.id,
          stopPointId,
          parentStationId,
          lineId,
          departurePoint: dep,
          arrivalPoint: arr,
        });
      }
    }

    if (legsPayload.length === 0) return;

    setIsRefreshingLive(true);
    try {
      const resp = await fetch('/api/journey/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs: legsPayload }),
      });
      const json = await resp.json();
      if (!resp.ok || json.status !== 'success') {
        throw new Error(json.error || 'Failed to refresh live departures');
      }

      const updates: Array<{ journeyIndex: number; legIndex: number; nextArrivals: any[]; platformName?: string }>
        = Array.isArray(json.data?.updates) ? json.data.updates : [];

      if (updates.length === 0) return;

      setJourneyResults((prev: any) => {
        if (!prev) return prev;
        const next = { ...prev, journeys: prev.journeys.map((j: any) => ({ ...j })) };
        for (const u of updates) {
          const j = next.journeys[u.journeyIndex];
          if (!j) continue;
          const leg = j.legs?.[u.legIndex];
          if (!leg) continue;
          const enh = { ...(leg.enhancements || {}) };
          enh.nextArrivals = u.nextArrivals || [];
          if (u.platformName) enh.platformName = u.platformName;
          leg.enhancements = enh;
        }
        return next;
      });
    } catch (e) {
      // Swallow errors; live refresh is best-effort
    } finally {
      setIsRefreshingLive(false);
    }
  };

  // Background full re-plan every 3 minutes
  useEffect(() => {
    const id = setInterval(() => {
      if (!lastSearchParamsRef.current) return;
      if (isRefreshingJourney) return;
      void handleJourneyRefresh();
    }, 180000);
    return () => clearInterval(id);
  }, [isRefreshingJourney]);

  // Handle voice input
  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  const processVoiceTranscription = async (audioBlob: Blob) => {
    setIsProcessingVoice(true);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice-input.webm');

      const response = await fetch('/api/nlp/transcribe', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || result.status !== 'success') {
        throw new Error(result.error || 'Failed to transcribe audio');
      }

      const transcription = result.data?.text?.trim?.() || '';

      if (transcription) {
        setNaturalLanguageQuery(transcription);
        toast({
          title: 'Voice input transcribed',
          description: transcription,
        });
      } else {
        toast({
          title: 'No speech detected',
          description: 'Please try speaking again clearly.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Voice transcription error:', error);
      toast({
        title: 'Voice input error',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingVoice(false);
    }
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({
        title: 'Microphone not supported',
        description: "Your browser doesn't support voice input",
        variant: 'destructive',
      });
      return;
    }

    if (isProcessingVoice) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.onstart = () => {
        setIsListening(true);
        toast({
          title: 'Listening...',
          description: 'Speak your journey request clearly.',
        });
      };

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setIsListening(false);
        toast({
          title: 'Microphone error',
          description: 'There was a problem capturing audio.',
          variant: 'destructive',
        });
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        const chunks = audioChunksRef.current;
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];

        if (chunks.length === 0) {
          return;
        }

        const blobType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunks, { type: blobType });

        await processVoiceTranscription(audioBlob);
      };

      mediaRecorder.start();
    } catch (error) {
      console.error('Error starting voice recording:', error);
      setIsListening(false);

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      toast({
        title: 'Microphone access denied',
        description: 'Please allow microphone access to use voice input.',
        variant: 'destructive',
      });
    }
  };

  const toggleVoiceInput = async () => {
    if (isListening) {
      stopVoiceRecording();
      return;
    }

    await startVoiceRecording();
  };

  // Handle location permission
  const handleLocationRequest = async () => {
    if (!isLocationSupported) {
      toast({
        title: "Location not supported",
        description: "Your browser doesn't support location services",
        variant: "destructive",
      });
      return;
    }

    // Check permission state
    if (permissionState.prompt || permissionState.denied) {
      setShowLocationPermission(true);
    } else {
      await requestLocation();
      
      if (locationError) {
        toast({
          title: "Location error",
          description: locationError.message,
          variant: "destructive",
        });
      } else if (location) {
        toast({
          title: "Location obtained",
          description: "We'll use your current location as the starting point",
        });
      }
    }
  };

  // Handle location permission response
  const handleLocationAllow = async () => {
    const resolvedLocation = await ensureLocation();

    if (resolvedLocation) {
      setShowLocationPermission(false);
      toast({
        title: 'Location obtained',
        description: "We'll use your current location as the starting point",
      });

      if (isManualMode) {
        setManualFrom('Current location');
      }

      if (pendingParamsRef.current) {
        const nextParams: JourneySearchParams = {
          ...pendingParamsRef.current,
          from: pendingParamsRef.current.from || `${resolvedLocation.latitude},${resolvedLocation.longitude}`,
        };
        pendingParamsRef.current = null;
        setUiState(prev => ({ ...prev, isLoading: true }));
        try {
          await executeJourney(nextParams, true);
        } finally {
          setUiState(prev => ({ ...prev, isLoading: false }));
        }
      }
    } else {
      toast({
        title: 'Location still required',
        description: 'Please enable location services in your browser settings or enter a starting station.',
        variant: 'destructive',
      });
    }
  };

  const handleLocationDeny = () => {
    setShowLocationPermission(false);
    toast({
      title: "Location access denied",
      description: "You can still enter your starting location manually",
    });
  };

  // Toggle between input modes
  const toggleInputMode = () => {
    setUiState(prev => ({
      ...prev,
      inputMode: prev.inputMode === 'natural-language' ? 'manual-selection' : 'natural-language',
    }));
  };

  // Submit on Enter (Shift+Enter for newline) in NL textarea
  const handleNlKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e as any).nativeEvent?.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // Focus input on mount and mark hydration complete
  useEffect(() => {
    setHasMounted(true);
    inputRef.current?.focus();
  }, []);

  // Auto-grow natural language textarea as content changes
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [naturalLanguageQuery]);

  // Load history on mount
  useEffect(() => {
    try {
      const nl = JSON.parse(localStorage.getItem('journeySearchHistory:nl') || '[]');
      if (Array.isArray(nl)) setRecentNlQueries(nl.slice(0, MAX_RECENT_HISTORY_ITEMS));
    } catch {}
    try {
      const manual = JSON.parse(localStorage.getItem('journeySearchHistory:manual') || '[]');
      if (Array.isArray(manual)) setRecentManualPairs(manual.slice(0, MAX_RECENT_HISTORY_ITEMS));
    } catch {}
  }, []);

  // Cleanup voice recording resources on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      audioChunksRef.current = [];
    };
  }, []);

  // Show journey results if available
  if (journeyResults) {
    return (
      <div className="w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-2">
        <JourneyResults
          journeys={journeyResults.journeys}
          fromName={journeyResults.fromName}
          toName={journeyResults.toName}
          onRefreshLive={refreshLiveDepartures}
          refreshingLive={isRefreshingLive}
          onRefreshFull={handleJourneyRefresh}
          refreshingFull={isRefreshingJourney}
          onClose={() => {
            setJourneyResults(null);
            setNaturalLanguageQuery('');
            setManualFrom('');
            setManualTo('');
            lastSearchParamsRef.current = null;
          }}
          onSelectJourney={(journey) => {
            console.log('Selected journey:', journey);
            // TODO: Show detailed journey view
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-top-2">
      <Card className="border-2 border-border shadow-lg bg-background transition-all duration-300 hover:shadow-xl">
        <CardContent className="pt-10 pb-10 px-6 md:pt-12 md:pb-12 md:px-10">
        {/* Simple Input Mode Toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-muted rounded-lg p-1">
            <button
              type="button"
              onClick={() => setUiState(prev => ({ ...prev, inputMode: 'natural-language' }))}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200 text-sm font-medium ${
                uiState.inputMode === 'natural-language'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Mic className="h-4 w-4" />
              Talk to me
            </button>
            <button
              type="button"
              onClick={() => setUiState(prev => ({ ...prev, inputMode: 'manual-selection' }))}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200 text-sm font-medium ${
                uiState.inputMode === 'manual-selection'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MapPin className="h-4 w-4" />
              Pick destination
            </button>
          </div>
        </div>

        {/* Natural Language Input */}
        {uiState.inputMode === 'natural-language' ? (
          <form onSubmit={handleSubmit} className="space-y-10">
            <div className="space-y-6">
              <label className="block text-xl font-semibold text-foreground">
                Where would you like to go?
              </label>
              <div className="flex flex-wrap items-stretch gap-4">
                <div className="relative flex-[1_1_100%] sm:flex-[1_1_auto] sm:flex-1 min-w-[240px]">
                  <Textarea
                    ref={inputRef}
                    rows={2}
                    placeholder=""
                    value={naturalLanguageQuery}
                    onChange={(e) => setNaturalLanguageQuery(e.target.value)}
                    onKeyDown={handleNlKeyDown}
                    disabled={uiState.isLoading || isListening}
                    className="min-h-16 text-lg md:text-xl border-3 border-border focus-visible:border-tfl-blue focus-visible:ring-0 focus-visible:ring-offset-0 rounded-xl px-6 py-4 leading-relaxed transition-shadow duration-200 focus:shadow-md"
                    aria-label="Journey destination"
                    enterKeyHint="send"
                  />
                  {!naturalLanguageQuery.trim() && (
                    <div
                      className={`pointer-events-none absolute left-0 top-0 px-6 py-4 text-lg md:text-xl text-muted-foreground select-none transition-opacity duration-300 ${exampleFading ? 'opacity-0' : 'opacity-80'}`}
                      aria-hidden="true"
                    >
                      {EXAMPLE_PLACEHOLDERS[displayExampleIdx]}
                    </div>
                  )}
                </div>
                <div className="relative inline-flex">
                  {/* Microphone button with subtle pulse when listening */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void toggleVoiceInput();
                    }}
                    disabled={uiState.isLoading || isProcessingVoice}
                    className={`h-14 w-14 sm:h-16 sm:w-16 border-3 rounded-xl transition-all duration-200 hover:shadow-md active:scale-95 ${
                      isListening
                        ? 'bg-tfl-red text-white border-tfl-red'
                        : 'hover:bg-tfl-blue/10 hover:text-tfl-blue hover:border-tfl-blue'
                    }`}
                    aria-label={
                      isProcessingVoice
                        ? 'Processing voice input'
                        : isListening
                        ? 'Stop voice input'
                        : 'Start voice input'
                    }
                  >
                    {/* ping ring when listening */}
                    {isListening && (
                      <span className="pointer-events-none absolute inline-flex h-full w-full rounded-xl ring-2 ring-tfl-red/60 animate-ping" />
                    )}
                    {isProcessingVoice ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : isListening ? (
                      <MicOff className="h-7 w-7" />
                    ) : (
                      <Mic className="h-7 w-7" />
                    )}
                  </Button>
                </div>
                <Button
                  type="submit"
                  disabled={uiState.isLoading || !naturalLanguageQuery.trim()}
                  className="h-14 sm:h-16 w-full flex-1 sm:w-16 sm:flex-none bg-tfl-blue hover:bg-tfl-blue/90 text-white border-3 border-tfl-blue rounded-xl transition-all duration-200 hover:shadow-lg active:scale-95 disabled:opacity-50"
                  aria-label="Plan journey"
                >
                  {uiState.isLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Send className="h-6 w-6" />
                  )}
                </Button>
              </div>
            </div>

            {/* Recent searches */}
            {hasMounted && recentNlQueries.length > 0 && (
              <div className="text-center">
                <div className="inline-flex gap-2 flex-wrap justify-center">
                  {recentNlQueries.slice(0, MAX_RECENT_HISTORY_ITEMS).map((q, idx) => (
                    <button
                      key={`${q}-${idx}`}
                      type="button"
                      onClick={() => setNaturalLanguageQuery(q)}
                      className="text-sm px-3 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all duration-200"
                      aria-label={`Use recent search ${q}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Quick Examples */}
          </form>
        ) : (
          /* Manual Station Selection */
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-6">
              {/* From Station */}
              <div>
                <label className="text-xl font-semibold text-foreground block mb-4">
                  From <span className="text-muted-foreground font-normal text-lg">(optional)</span>
                </label>
                <div className="flex items-center justify-between mb-3">
                  <div></div>
                  {hasMounted && isLocationSupported && !location && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleLocationRequest}
                      disabled={locationLoading}
                      className="h-12 px-4 border-2 border-border hover:bg-tfl-blue/10 hover:text-tfl-blue hover:border-tfl-blue rounded-lg text-lg"
                    >
                      <MapPin className="h-5 w-5 mr-2" />
                      Use my location
                    </Button>
                  )}
                </div>
                <StationSelector
                  value={manualFrom}
                  onChange={setManualFrom}
                  placeholder="Your location"
                  disabled={uiState.isLoading}
                />
              </div>

              {/* Direction indicator */}
              <div className="flex items-center justify-center gap-3 my-2">
                <div className="flex-1 h-[3px] bg-muted"></div>
                <ArrowRight className="h-7 w-7 text-foreground/80 flex-shrink-0" aria-hidden="true" />
                <div className="flex-1 h-[3px] bg-muted"></div>
              </div>

              {/* Swap action removed per request (keep only the arrow) */}

              {/* To Station */}
              <div>
                <label className="text-xl font-semibold text-foreground block mb-4">
                  To
                </label>
                <StationSelector
                  value={manualTo}
                  onChange={setManualTo}
                  placeholder="Where to?"
                  disabled={uiState.isLoading}
                />
              </div>
            </div>

            {/* Recent journeys */}
            {hasMounted && recentManualPairs.length > 0 && (
              <div className="text-center">
                <div className="inline-flex gap-2 flex-wrap justify-center">
                  {recentManualPairs.slice(0, MAX_RECENT_HISTORY_ITEMS).map((p, idx) => (
                    <button
                      key={`${p.from}-${p.to}-${idx}`}
                      type="button"
                      onClick={() => {
                        setManualFrom(p.from);
                        setManualTo(p.to);
                      }}
                      className="text-sm px-3 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all duration-200"
                      aria-label={`Use recent journey ${p.from || 'Current location'} to ${p.to}`}
                    >
                      {(p.from || 'Current location') + ' → ' + p.to}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="h-14 w-full sm:h-16 bg-tfl-blue hover:bg-tfl-blue/90 text-white border-3 border-tfl-blue rounded-xl transition-all duration-200 hover:shadow-lg active:scale-95 disabled:opacity-50"
              disabled={uiState.isLoading || !manualTo.trim()}
              aria-label="Plan journey"
            >
              {uiState.isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Send className="h-6 w-6" />
              )}
            </Button>
          </form>
        )}

        {/* Location permission prompt */}
        {hasMounted && isLocationSupported && permissionState.prompt && !location && (
          <div className="mt-8 text-center">
            <p className="text-muted-foreground mb-4">
              Want faster planning? Enable location to use your current position as the starting point.
            </p>
            <Button
              variant="outline"
              onClick={handleLocationRequest}
              disabled={locationLoading}
              className="h-12 px-6 border-2 border-border hover:bg-tfl-blue/10 hover:text-tfl-blue hover:border-tfl-blue transition-all duration-200"
            >
              {locationLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Getting location...
                </>
              ) : (
                <>
                  <MapPin className="mr-2 h-4 w-4" />
                  Enable Location
                </>
              )}
            </Button>
          </div>
        )}

        {/* Location permission modal */}
        {hasMounted && showLocationPermission && (
          <LocationPermission
            onAllow={handleLocationAllow}
            onDeny={handleLocationDeny}
            onClose={() => setShowLocationPermission(false)}
            loading={locationLoading}
            error={locationError?.message}
          />
        )}
      </CardContent>
    </Card>
    </div>
  );
}
