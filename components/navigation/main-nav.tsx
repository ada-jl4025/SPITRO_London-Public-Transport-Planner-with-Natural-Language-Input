"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronDown, Menu, X } from 'lucide-react';
import {
  ALL_MODE_OPTION,
  MODE_KEYS,
  getModeLabel,
  modeConfig,
  normalizeModeSelection,
  type ModeSelectionValue,
} from '@/lib/mode-config';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/journey', label: 'Journey planner' },
];

export function MainNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [mobileStatusOpen, setMobileStatusOpen] = useState(false);
  const [nextMenuOpen, setNextMenuOpen] = useState(false);
  const [mobileNextOpen, setMobileNextOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const nextMenuRef = useRef<HTMLDivElement | null>(null);

  const isActive = (href: string) => {
    return pathname === href || (href !== '/' && pathname.startsWith(href));
  };

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

  const statusOptions = useMemo(
    () =>
      modeOptions.map((option) => ({
        ...option,
        href:
          option.value === ALL_MODE_OPTION.value
            ? '/status'
            : `/status?mode=${encodeURIComponent(option.value)}`,
      })),
    [modeOptions]
  );

  const nextOptions = useMemo(
    () =>
      modeOptions.map((option) => ({
        ...option,
        href:
          option.value === ALL_MODE_OPTION.value
            ? '/next-available'
            : `/next-available?mode=${encodeURIComponent(option.value)}`,
      })),
    [modeOptions]
  );

  const modeParam = searchParams?.get('mode');
  const currentStatusMode = pathname.startsWith('/status')
    ? normalizeModeSelection(modeParam)
    : ALL_MODE_OPTION.value;
  const currentStatusLabel = getModeLabel(currentStatusMode);
  const currentNextMode = pathname.startsWith('/next-available')
    ? normalizeModeSelection(modeParam)
    : ALL_MODE_OPTION.value;
  const currentNextLabel = getModeLabel(currentNextMode);
  const isStatusActive = pathname.startsWith('/status');
  const isNextActive = pathname.startsWith('/next-available');
  const activeStatusOption =
    statusOptions.find((option) => option.value === currentStatusMode) ?? statusOptions[0];
  const activeNextOption =
    nextOptions.find((option) => option.value === currentNextMode) ?? nextOptions[0];
  const StatusIcon = activeStatusOption.icon;
  const NextIcon = activeNextOption.icon;

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
    setStatusMenuOpen(false);
    setMobileStatusOpen(false);
    setNextMenuOpen(false);
    setMobileNextOpen(false);
  }, [pathname]);

  // Handle escape key to close menu
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      if (mobileMenuOpen) {
        setMobileMenuOpen(false);
      }

      if (statusMenuOpen) {
        setStatusMenuOpen(false);
      }

      if (mobileStatusOpen) {
        setMobileStatusOpen(false);
      }

      if (nextMenuOpen) {
        setNextMenuOpen(false);
      }

      if (mobileNextOpen) {
        setMobileNextOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileMenuOpen, statusMenuOpen, mobileStatusOpen, nextMenuOpen, mobileNextOpen]);

  // Close desktop status menu on outside click
  useEffect(() => {
    if (!statusMenuOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (!statusMenuRef.current) return;
      if (statusMenuRef.current.contains(event.target as Node)) return;
      setStatusMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!nextMenuOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (!nextMenuRef.current) return;
      if (nextMenuRef.current.contains(event.target as Node)) return;
      setNextMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [nextMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      setMobileStatusOpen(false);
      setMobileNextOpen(false);
    }
  }, [mobileMenuOpen]);

  return (
    <>
      {/* Desktop Navigation */}
      <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 md:px-5 md:text-base",
                active
                  ? "text-blue-600 bg-blue-50"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              {item.label}
              {active && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-blue-600" aria-hidden="true" />
              )}
            </Link>
          );
        })}

        <div className="relative" ref={statusMenuRef}>
          <button
            type="button"
            onClick={() => setStatusMenuOpen((prev) => !prev)}
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 md:px-5 md:text-base",
              isStatusActive || statusMenuOpen
                ? "bg-blue-50 text-blue-600"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
            aria-haspopup="true"
            aria-expanded={statusMenuOpen}
          >
            <div className="flex flex-col items-start leading-tight">
              <span>Service status</span>
              {(isStatusActive || statusMenuOpen) && (
                <span className="text-xs font-normal text-gray-500">{currentStatusLabel}</span>
              )}
            </div>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", statusMenuOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>

          {statusMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
              <div role="menu" aria-label="Service status modes" className="flex flex-col gap-1">
                {statusOptions.map((option) => {
                  const Icon = option.icon;
                  const optionActive = isStatusActive && currentStatusMode === option.value;
                  const optionColor =
                    option.value === ALL_MODE_OPTION.value
                      ? '#1D70B8'
                      : modeConfig[
                          option.value as Exclude<ModeSelectionValue, typeof ALL_MODE_OPTION.value>
                        ]?.color ?? '#1D70B8';

                  return (
                    <Link
                      key={option.value}
                      href={option.href}
                      onClick={() => {
                        setStatusMenuOpen(false);
                      }}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                        optionActive
                          ? "bg-blue-50 text-blue-700"
                          : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                      )}
                      role="menuitem"
                    >
                      <span
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
                        style={{ color: optionColor }}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="flex-1 text-left">{option.label}</span>
                      {optionActive && (
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">Current</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={nextMenuRef}>
          <button
            type="button"
            onClick={() => setNextMenuOpen((prev) => !prev)}
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 md:px-5 md:text-base",
              isNextActive || nextMenuOpen
                ? "bg-blue-50 text-blue-600"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
            aria-haspopup="true"
            aria-expanded={nextMenuOpen}
          >
            <div className="flex flex-col items-start leading-tight">
              <span>Next available</span>
              {(isNextActive || nextMenuOpen) && (
                <span className="text-xs font-normal text-gray-500">{currentNextLabel}</span>
              )}
            </div>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", nextMenuOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>

          {nextMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
              <div role="menu" aria-label="Next available modes" className="flex flex-col gap-1">
                {nextOptions.map((option) => {
                  const Icon = option.icon;
                  const optionActive = isNextActive && currentNextMode === option.value;
                  const optionColor =
                    option.value === ALL_MODE_OPTION.value
                      ? '#1D70B8'
                      : modeConfig[
                          option.value as Exclude<ModeSelectionValue, typeof ALL_MODE_OPTION.value>
                        ]?.color ?? '#1D70B8';

                  return (
                    <Link
                      key={option.value}
                      href={option.href}
                      onClick={() => {
                        setNextMenuOpen(false);
                      }}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                        optionActive
                          ? "bg-blue-50 text-blue-700"
                          : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                      )}
                      role="menuitem"
                    >
                      <span
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
                        style={{ color: optionColor }}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="flex-1 text-left">{option.label}</span>
                      {optionActive && (
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">Current</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle navigation menu"
        aria-expanded={mobileMenuOpen}
      >
        {mobileMenuOpen ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <Menu className="h-6 w-6" aria-hidden="true" />
        )}
      </Button>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <nav
            className="relative top-[64px] h-[calc(100vh-64px)] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
            aria-label="Mobile navigation"
          >
            <div className="px-6 pt-6 pb-24 space-y-8">
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Navigate
                </p>
                <div className="mt-4 space-y-2">
                  {navItems.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          "flex items-center justify-between rounded-2xl border px-4 py-3 text-base font-medium transition",
                          active
                            ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
                            : "border-transparent bg-white text-gray-800 hover:border-blue-100 hover:bg-blue-50/60"
                        )}
                      >
                        <span>{item.label}</span>
                        {active && (
                          <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                            Current
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Live transport
                </p>
                <div className="mt-4 space-y-4">
                  <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-blue-50/70 via-white to-white p-4 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setMobileStatusOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-2xl bg-white/80 px-3 py-2 text-left transition hover:bg-white"
                      aria-expanded={mobileStatusOpen}
                    >
                      <span className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600/10 text-blue-600">
                          <StatusIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="flex flex-col leading-tight">
                          <span className="text-sm font-semibold text-gray-900">Service status</span>
                          {(isStatusActive || mobileStatusOpen) && (
                            <span className="text-xs text-muted-foreground">{currentStatusLabel}</span>
                          )}
                        </span>
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          mobileStatusOpen && "rotate-180"
                        )}
                        aria-hidden="true"
                      />
                    </button>

                    {mobileStatusOpen && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {statusOptions.map((option) => {
                          const Icon = option.icon;
                          const optionActive = isStatusActive && currentStatusMode === option.value;

                          return (
                            <Link
                              key={option.value}
                              href={option.href}
                              onClick={() => {
                                setMobileMenuOpen(false);
                                setMobileStatusOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition",
                                optionActive
                                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                  : "border-border bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                              )}
                            >
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/70">
                                <Icon className={cn("h-3.5 w-3.5", optionActive ? "text-white" : "text-blue-700")} aria-hidden="true" />
                              </span>
                              <span>{option.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-orange-50/70 via-white to-white p-4 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setMobileNextOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-2xl bg-white/80 px-3 py-2 text-left transition hover:bg-white"
                      aria-expanded={mobileNextOpen}
                    >
                      <span className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/10 text-orange-600">
                          <NextIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="flex flex-col leading-tight">
                          <span className="text-sm font-semibold text-gray-900">Next available</span>
                          {(isNextActive || mobileNextOpen) && (
                            <span className="text-xs text-muted-foreground">{currentNextLabel}</span>
                          )}
                        </span>
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          mobileNextOpen && "rotate-180"
                        )}
                        aria-hidden="true"
                      />
                    </button>

                    {mobileNextOpen && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {nextOptions.map((option) => {
                          const Icon = option.icon;
                          const optionActive = isNextActive && currentNextMode === option.value;

                          return (
                            <Link
                              key={option.value}
                              href={option.href}
                              onClick={() => {
                                setMobileMenuOpen(false);
                                setMobileNextOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition",
                                optionActive
                                  ? "border-orange-500 bg-orange-500 text-white shadow-sm"
                                  : "border-border bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50"
                              )}
                            >
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/70">
                                <Icon className={cn("h-3.5 w-3.5", optionActive ? "text-white" : "text-orange-600")} aria-hidden="true" />
                              </span>
                              <span>{option.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

