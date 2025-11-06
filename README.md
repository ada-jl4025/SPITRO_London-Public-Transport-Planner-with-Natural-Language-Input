# Spitro – Open Source London Journey Planner

Spitro is a modern, accessible journey planning platform for London's public transport network. Plan your journey using natural language, get real-time arrival information, and check service status — all from an open-source project you can adopt and extend.

<div align="center">

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-Spitro.com-2563eb?style=for-the-badge&logo=vercel&logoColor=white)](https://spitro.com/)

</div>

## Features

- 🗣️ Natural language journey planning
- 🚇 Real-time arrival information
- 📍 Automatic location detection
- 🧭 Next available departures near you
- ♿ Accessibility-first design
- 📱 Mobile-responsive interface
- 🔄 Live service status updates

## Tech Stack

- **Frontend**: Next.js 14 with App Router, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components
- **APIs**: TFL Unified API, Azure OpenAI, Geocoding services
- **Deployment**: Vercel

## National Rail Live Departures (Optional)

You can enrich National Rail legs with live “Next departures” and platform info.

### Server-side Configuration

We support either a REST bridge or OpenLDBWS SOAP. Configure one of the following in your `.env.local` (server-only values; never expose tokens client-side):

```bash
# Turn on National Rail enrichment
NR_API_ENABLED=true

# Option A: REST bridge/proxy (preferred if you have one)
NR_API_BASE_URL=https://your-rest-bridge.example.com
NR_API_KEY=your-rest-api-key
NR_API_HEADER_NAME=x-api-key # optional

# Option B: OpenLDBWS SOAP (official)
NR_LDBWS_URL=https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx
NR_LDBWS_TOKEN=your-ldbws-token
# These default to current versions, override only if needed:
NR_LDBWS_NS=http://thalesgroup.com/RTTI/2017-10-01/ldb/
NR_LDBWS_COMMON_NS=http://thalesgroup.com/RTTI/2017-10-01/ldb/commontypes
```

Notes:
- If `NR_API_ENABLED=true`, the app will use the REST bridge when `NR_API_BASE_URL` and `NR_API_KEY` are provided; otherwise it will use OpenLDBWS with `NR_LDBWS_URL` and `NR_LDBWS_TOKEN`.
- CRS codes are extracted from TfL `StopPoint` data (via `icsCode` or additional properties). If CRS is missing for a leg, NR fetch is skipped gracefully.
- No NR credentials are ever sent to the browser; all calls are server-side.

### Install dependency

The SOAP option uses a lightweight XML parser:

```bash
npm install
```

This ensures `fast-xml-parser` is installed from `package.json`.

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Azure OpenAI
AZURE_API_TARGET_URL=https://your-instance.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2025-01-01-preview
AZURE_TRANSCRIPTION_TARGET_URL=https://your-instance.openai.azure.com/openai/deployments/your-whisper-deployment/audio/transcriptions?api-version=2024-06-01
AZURE_API_KEY=

# TFL API (optional - for higher rate limits)
TFL_API_PRIMARY_KEY=
TFL_API_SECONDARY_KEY=
NEXT_PUBLIC_TFL_API_KEY=
# Alternatively, provide a prioritized comma-separated list (uses round-robin + auto-fallback)
# Example: TFL_API_KEYS=keyA,keyB,keyC
TFL_API_KEYS=

# Geocoding (Choose one: Google Maps or Mapbox)
GEOCODING_API_KEY=
GEOCODING_PROVIDER=google  # or 'mapbox'
```

`TFL_API_PRIMARY_KEY` is used first for every request, and the application automatically falls back to `TFL_API_SECONDARY_KEY` when the primary key is rate limited. For multiple keys, set `TFL_API_KEYS` with a comma-separated list. The app rotates keys to spread load and, on a 429/limit, seamlessly retries with the next key (respecting any `Retry-After` header). `NEXT_PUBLIC_TFL_API_KEY` remains supported for legacy setups but is optional when the primary key is configured.

### Getting API Keys

1. **Azure OpenAI**
   - Sign up at [Azure Portal](https://portal.azure.com)
   - Create an OpenAI resource
   - Deploy a model (GPT-4 or GPT-5)
   - Copy the endpoint URL and API key

2. **TFL API** (Optional)
   - Register at [TFL API Portal](https://api-portal.tfl.gov.uk)
   - Most endpoints work without authentication
- API key provides higher rate limits
- Configure `TFL_API_KEYS` with multiple keys (preferred) or use `TFL_API_PRIMARY_KEY` and `TFL_API_SECONDARY_KEY`

3. **Mapbox Geocoding** (Currently configured)
   - Sign up at [Mapbox](https://www.mapbox.com)
   - Get your public access token (starts with `pk.`)
   - Public tokens are safe for client-side use
   
   Alternative: **Google Maps Geocoding**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Enable Geocoding API
   - Create API key with restrictions
   - Change `GEOCODING_PROVIDER` to `google` in `.env.local`


## Quick Start

### Option 1: Using Setup Script

```bash
# Clone the repository
git clone <your-repo-url>
cd spitro

# Run the setup script
./setup.sh

# Configuration is already set in .env.local
# Update any missing API keys if needed
nano .env.local  # or use your preferred editor

# Start the development server
npm run dev
```

### Option 2: Manual Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env.local`
4. Add your API keys to `.env.local`
5. Run the development server:
   ```bash
   npm run dev
   ```
6. Open [http://localhost:3000](http://localhost:3000)

## Usage

### Natural Language Journey Planning
Simply type where you want to go:
- "I am going to Hammersmith"
- "To Hammersmith from Westfield in White City"
- "Oxford Circus to Heathrow Terminal 5"

### Manual Station Selection
Click "Select stations manually" to choose from a list of all TFL stations.

### Location-based Search
Allow location access to automatically find the nearest station as your starting point.

### Next Available Departures (Nearby)
- Go to `Next available` in the navigation (route: `/next-available`).
- Click "Use my location" and grant permission.
- The page lists nearby stations and stops (Tube, bus, rail, etc.).
- Expand a station card to see the upcoming services grouped by line and platform.
- Click "Walk directions" to open walking directions in Google Maps.

## API Documentation

### Journey Planning
- Endpoint: `/api/journey`
- Method: POST
- Body: `{ query: string }` or `{ from: string, to: string }`

### Service Status
- Endpoint: `/api/status`
- Method: GET
- Query params: `mode` (tube, bus, dlr, overground)

#### Auto-fetch cadence and caching

- A scheduled job keeps `/api/status/refresh` running on a tight cadence using the `TFL_API_KEYS_AUTOFETCH` key rotation list. Each run stores a fresh snapshot in the Supabase table `service_status_snapshots`. Vercel's native Cron Jobs are limited to 1-minute granularity (`* * * * *`). If you need true 30-second intervals, configure an external scheduler (e.g. GitHub Actions, Supabase Edge Function scheduler, or another cron service) to call `/api/status/refresh` every 30 seconds.
- When `/api/status` is called, the API returns the most recent snapshot as long as it is not older than 2 minutes.
- If the latest snapshot is older than 2 minutes, the API triggers an on-demand refresh (still using `TFL_API_KEYS_AUTOFETCH`), re-reads Supabase, and only falls back to a direct TfL fetch if no newer data is available. The direct fetch is persisted back into Supabase for subsequent requests.
- Ensure `TFL_API_KEYS_AUTOFETCH` is configured as a comma-separated list of TfL API keys in the server environment.

- Endpoint: `/api/status/refresh`
  - Method: GET
  - Purpose: background/cron ingestion to keep Supabase snapshots within 30 seconds of the latest TfL data when invoked on that cadence.

### Station Search
- Endpoint: `/api/stations/search`
- Method: GET
- Query params: `q` (search query)

### Nearby Stations (for Next Available)
- Endpoint: `/api/stations/nearby`
- Methods: `POST` (recommended) and `GET`
- POST Body:
  ```json
  {
    "lat": 51.501,
    "lon": -0.1246,
    "radius": 1000,
    "modes": ["tube", "bus"],
    "categories": ["Public Transport"]
  }
  ```
- GET Query params: `lat`, `lon`, `radius` (optional), `modes` (comma-separated), `categories` (comma-separated)
- Success Response (shape abbreviated):
  ```json
  {
    "status": "success",
    "data": {
      "location": { "lat": 51.5, "lon": -0.12, "name": "..." },
      "stations": [
        {
          "id": "940GZZLU...",
          "naptanId": "...",
          "name": "Victoria Underground Station",
          "modes": ["tube"],
          "lat": 51.4952,
          "lon": -0.1441,
          "zone": "1",
          "distance": 213.4,
          "distanceFormatted": "0.2 km",
          "lines": [{ "id": "victoria", "name": "Victoria" }]
        }
      ],
      "total": 5,
      "radius": 1000
    }
  }
  ```
- Error cases include invalid/missing coordinates and locations outside the London area.

### Station Arrivals (grouped by line/platform)
- Endpoint: `/api/stations/{id}/arrivals`
- Method: GET
- Query params:
  - `grouped`: `true|false` (default `true`). When `true`, results are grouped by line and platform.
  - `limit`: number (optional). Limits number of arrival predictions before grouping.
- Success Response (grouped example, abbreviated):
  ```json
  {
    "status": "success",
    "data": {
      "stopPointId": "940GZZLU...",
      "total": 23,
      "grouped": [
        {
          "key": "Victoria::Platform 1::outbound",
          "lineName": "Victoria",
          "platformName": "Platform 1",
          "direction": "outbound",
          "modeName": "tube",
          "arrivals": [
            { "id": "...", "destinationName": "Walthamstow Central", "expectedArrival": "...", "timeToStation": 120 }
          ]
        }
      ]
    }
  }
  ```

## Deployment to Vercel

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo>
   git push -u origin main
   ```

2. **Import to Vercel**
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "New Project"
   - Import your GitHub repository
   - Vercel will auto-detect Next.js

3. **Configure Environment Variables**
   - In Vercel project settings, go to "Environment Variables"
   - Add all variables from your `.env.local` file
   - Ensure `NEXT_PUBLIC_` variables are added correctly
   - The Mapbox token is already configured in `.env.local`

4. **Deploy**
   - Click "Deploy"
   - Your app will be live at `https://your-project.vercel.app`

## Testing

To test the application locally:

1. **Journey Planning**
   - Try: "I'm going to Kings Cross"
   - Try: "Victoria to Heathrow Terminal 5"
   - Test manual station selection

2. **Service Status**
   - Check live line statuses
   - Test search and filtering
   - Verify auto-refresh works

3. **Accessibility**
   - Test keyboard navigation
   - Try voice input (Chrome/Edge)
   - Check screen reader compatibility

## LLM → Mapbox → TfL Pipeline (Preferences Preserved)

This app supports natural language journey planning with a strict pipeline that preserves user preferences end‑to‑end:

1) LLM parsing (Azure OpenAI)
- Extracts: from/to/via, modes, accessibility, time (arrive/depart), walkingSpeed, journeyPreference, maxWalkingMinutes, maxTransferMinutes.
- “only” vs “prefer”: when the user says “tube only …” we restrict modes; otherwise we prefer the listed modes but allow others.

2) Location resolution (TfL StopPoint → Mapbox/Google fallback)
- We first try TfL StopPoint search for named places; if none are found, we geocode with Mapbox (or Google) and use coordinates.
- Resolving locations never drops preferences.

3) TfL Journey Planner
- We pass all preferences directly to `/Journey/JourneyResults/{from}/to/{to}` as query params:
  - mode (comma-separated), accessibilityPreference, journeyPreference, walkingSpeed,
    maxWalkingMinutes, maxTransferMinutes, date, time, timeIs, via, viaName, alternativeRoute.
- Results are optionally reordered to prefer mentioned modes when not “only”.

Quick local E2E check

```bash
# Start prod server (example)
npm run build && npm run start -p 3556

# Example: bus-only query
curl -s -X POST http://localhost:3556/api/journey \
  -H 'Content-Type: application/json' \
  -d '{"naturalLanguageQuery":"Bus only from Clapham Junction to Waterloo"}' | jq '.data.journeys[0].legs[].mode.id'
```

## Troubleshooting

- **"Location not supported"**: Ensure HTTPS or localhost
- **"Azure OpenAI error"**: Check API key and endpoint URL format
- **"No stations found"**: Verify TFL API is accessible
- **"Geocoding failed"**: Check API key and quota

## License

MIT

## Attribution

Data provided by Transport for London
