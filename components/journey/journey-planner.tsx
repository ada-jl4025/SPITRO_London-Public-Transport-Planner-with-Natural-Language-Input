"use client";

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useGeolocation } from '@/hooks/useGeolocation';
import { StationSelector } from './station-selector';
import { LocationPermission } from './location-permission';
import { JourneyResults } from './journey-results';
import { MapPin, Mic, MicOff, Send, ToggleLeft, ToggleRight, Loader2, ArrowUpDown } from 'lucide-react';
import type { UIState, JourneySearchParams } from '@/types';

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
  const [showLocationPermission, setShowLocationPermission] = useState(false);
  const [journeyResults, setJourneyResults] = useState<any>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const isManualMode = uiState.inputMode === 'manual-selection';

  // Recent search history (localStorage)
  const [recentNlQueries, setRecentNlQueries] = useState<string[]>([]);
  const [recentManualPairs, setRecentManualPairs] = useState<Array<{ from: string; to: string }>>([]);

  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
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
              const next = [q, ...prev.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, 10);
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
              const next = [{ from, to }, ...prev.filter(p => key(p) !== key({ from, to }))].slice(0, 10);
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

    const searchParams: JourneySearchParams =
      uiState.inputMode === 'natural-language'
        ? { naturalLanguageQuery }
        : { from: manualFrom, to: manualTo };

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

  // Focus input on mount and mark hydration complete
  useEffect(() => {
    setHasMounted(true);
    inputRef.current?.focus();
  }, []);

  // Load history on mount
  useEffect(() => {
    try {
      const nl = JSON.parse(localStorage.getItem('journeySearchHistory:nl') || '[]');
      if (Array.isArray(nl)) setRecentNlQueries(nl.slice(0, 10));
    } catch {}
    try {
      const manual = JSON.parse(localStorage.getItem('journeySearchHistory:manual') || '[]');
      if (Array.isArray(manual)) setRecentManualPairs(manual.slice(0, 10));
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
      <div className="w-full max-w-4xl mx-auto">
        <JourneyResults
          journeys={journeyResults.journeys}
          fromName={journeyResults.fromName}
          toName={journeyResults.toName}
          onRefresh={handleJourneyRefresh}
          refreshing={isRefreshingJourney}
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
    <Card className="w-full max-w-3xl mx-auto border-0 shadow-xl bg-background/95 backdrop-blur-sm">
      <CardContent className="pt-6 pb-6 px-4 md:pt-8 md:pb-8 md:px-8">
        {/* Input Mode Toggle - Larger & More Accessible */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <span className={`text-base font-medium ${uiState.inputMode === 'natural-language' ? 'text-foreground' : 'text-muted-foreground'}`}>
              Natural Language
            </span>
            <Button
              variant="ghost"
              size="lg"
              onClick={toggleInputMode}
              aria-label="Toggle input mode"
              className="h-12 w-12 p-0"
            >
              {uiState.inputMode === 'natural-language' ? <ToggleLeft className="h-6 w-6" /> : <ToggleRight className="h-6 w-6" />}
            </Button>
            <span className={`text-base font-medium ${uiState.inputMode === 'manual-selection' ? 'text-foreground' : 'text-muted-foreground'}`}>
              Select Stations
            </span>
          </div>
          
          {/* Location indicator */}
          {hasMounted && location && (
            <div className="flex items-center text-base text-muted-foreground">
              <MapPin className="h-5 w-5 mr-2 text-tfl-green" />
              <span>Using current location</span>
            </div>
          )}
        </div>

        {/* Natural Language Input */}
        {uiState.inputMode === 'natural-language' ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <Input
                ref={inputRef}
                type="text"
                placeholder="Where do you want to go?"
                value={naturalLanguageQuery}
                onChange={(e) => setNaturalLanguageQuery(e.target.value)}
                disabled={uiState.isLoading || isListening}
                className="pr-24 h-12 text-base md:pr-28 md:h-14 md:text-lg border-2 focus-visible:border-tfl-blue transition-colors"
                aria-label="Journey destination"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {/* Voice input button */}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void toggleVoiceInput();
                  }}
                  disabled={uiState.isLoading || isProcessingVoice}
                  className="h-10 w-10 rounded-full border-2"
                  aria-label={
                    isProcessingVoice
                      ? 'Processing voice input'
                      : isListening
                      ? 'Stop voice input'
                      : 'Start voice input'
                  }
                >
                  {isProcessingVoice ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isListening ? (
                    <MicOff className="h-5 w-5 text-tfl-red animate-pulse" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </Button>
                
                {/* Submit button */}
                <Button
                  type="submit"
                  size="icon"
                  disabled={uiState.isLoading || !naturalLanguageQuery.trim()}
                  className="h-10 w-10 rounded-full bg-tfl-blue hover:bg-tfl-blue/90"
                  aria-label="Plan journey"
                >
                  {uiState.isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>

            {/* Recent natural language searches */}
            {hasMounted && recentNlQueries.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Recent searches">
                {recentNlQueries.slice(0, 6).map((q, idx) => (
                  <Button
                    key={`${q}-${idx}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setNaturalLanguageQuery(q)}
                    aria-label={`Use recent search ${q}`}
                  >
                    {q}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRecentNlQueries([]);
                    try { localStorage.removeItem('journeySearchHistory:nl'); } catch {}
                  }}
                  aria-label="Clear search history"
                >
                  Clear
                </Button>
              </div>
            )}
            
            {/* Examples - Simplified (hidden on small screens) */}
            <div className="hidden sm:block text-base text-muted-foreground bg-muted/50 rounded-lg p-4">
              <p className="font-medium mb-2 text-foreground">Try saying:</p>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2">
                  <span className="text-tfl-blue">•</span>
                  <span>"To King's Cross"</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-tfl-blue">•</span>
                  <span>"From Paddington to Heathrow T5"</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-tfl-blue">•</span>
                  <span>"Royal School of Mines to Imperial white city"</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-tfl-blue">•</span>
                  <span>"From my location to Waterloo"</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-tfl-blue">•</span>
                  <span>"Hammersmith"</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-tfl-blue">•</span>
                  <span>"Get me to Canary Wharf"</span>
                </li>
              </ul>
            </div>
          </form>
        ) : (
          /* Manual Station Selection */
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-base font-semibold">
                    From <span className="text-muted-foreground font-normal text-sm">(optional)</span>
                  </label>
                  {hasMounted && isLocationSupported && !location && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleLocationRequest}
                      disabled={locationLoading}
                      className="h-9 px-3 text-sm"
                    >
                      <MapPin className="h-4 w-4 mr-2" />
                      Use my location
                    </Button>
                  )}
                </div>
                <StationSelector
                  value={manualFrom}
                  onChange={setManualFrom}
                  placeholder="Start station or location"
                  disabled={uiState.isLoading}
                />
              </div>
              {/* Swap control: stacked on mobile, overlay on larger screens */}
              <div className="md:relative">
                {/* Mobile: centered swap button */}
                <div className="md:hidden flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const temp = manualFrom;
                      setManualFrom(manualTo);
                      setManualTo(temp);
                    }}
                    className="h-9 px-3 rounded-full"
                    aria-label="Swap stations"
                  >
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                </div>
                {/* Desktop/Tablet: overlayed circular button */}
                <div className="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const temp = manualFrom;
                      setManualFrom(manualTo);
                      setManualTo(temp);
                    }}
                    className="h-12 w-12 rounded-full bg-card border-2 shadow-lg hover:shadow-xl hover:bg-accent transition-all"
                    aria-label="Swap stations"
                  >
                    <ArrowUpDown className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              
              <div>
                <label className="text-base font-semibold mb-3 block">
                  To
                </label>
                <StationSelector
                  value={manualTo}
                  onChange={setManualTo}
                  placeholder="Destination station"
                  disabled={uiState.isLoading}
                />
              </div>
            </div>

            {/* Recent manual searches */}
            {hasMounted && recentManualPairs.length > 0 && (
              <div className="space-y-2" aria-label="Recent journeys">
                <p className="text-sm text-muted-foreground">Recent journeys</p>
                <div className="flex flex-wrap gap-2">
                  {recentManualPairs.slice(0, 6).map((p, idx) => (
                    <Button
                      key={`${p.from}-${p.to}-${idx}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => {
                        setManualFrom(p.from);
                        setManualTo(p.to);
                      }}
                      aria-label={`Use recent journey ${p.from || 'Current location'} to ${p.to}`}
                    >
                      {(p.from || 'Current location') + ' → ' + p.to}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRecentManualPairs([]);
                      try { localStorage.removeItem('journeySearchHistory:manual'); } catch {}
                    }}
                    aria-label="Clear journey history"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}
            
            <Button 
              type="submit" 
              className="w-full h-12 text-base md:h-14 md:text-lg font-semibold bg-tfl-blue hover:bg-tfl-blue/90"
              disabled={uiState.isLoading || !manualTo.trim()}
            >
              {uiState.isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Planning journey...
                </>
              ) : (
                'Plan Journey'
              )}
            </Button>
          </form>
        )}

        {/* Location permission prompt */}
        {hasMounted && isLocationSupported && permissionState.prompt && !location && (
          <div className="mt-6 p-5 bg-muted/50 rounded-lg border border-muted-foreground/20">
            <p className="text-base mb-3">
              Enable location to automatically use your current position as the starting point.
            </p>
            <Button
              variant="outline"
              size="lg"
              onClick={handleLocationRequest}
              disabled={locationLoading}
              className="h-11"
            >
              <MapPin className="mr-2 h-5 w-5" />
              Enable Location
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
  );
}
