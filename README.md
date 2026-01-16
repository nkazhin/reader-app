# Reader App

Podtema Reader Mini App for displaying article summaries in Telegram with full analytics.

## Overview

Replaces Telegraph for article delivery with:
- Full analytics (user ID, content ID, timestamps)
- Cross-platform consistency (iOS, Android, Desktop)
- Two-tab UI (Summary + Full Translation)
- Proper table rendering with sticky headers
- No content length limits

## Structure

```
reader-app/
├── index.html          # Mini app (single file, deployed to CDN)
├── publish-gcf/        # Cloud Function for publishing content
│   ├── index.js
│   └── package.json
└── README.md
```

## Mini App (`index.html`)

Single-file HTML/CSS/JS that renders article content in Telegram.

**Features:**
- Header block with source info, title, date, authors
- Original article link block
- Two tabs: "Конспект" / "Полный перевод"
- Responsive table rendering with horizontal scroll
- Telegram theme integration
- Haptic feedback on tab switch
- Analytics tracking

**Deployment:**
```bash
# Upload to CDN at /reader/v1/index.html
# Immutable - version changes go to /reader/v2/
```

**URL format:**
```
https://cdn.etopodtema.com/reader/v1/?r={recordId}
```

## Publish GCF (`publish-gcf/`)

Publishes article content to CDN as JSON blobs.

**Service URL:** `https://reader-publish-305018873985.europe-west1.run.app`

**Endpoint:** `POST /`

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: {api_key}`

**Request:**
```json
{
  "recordId": "recABC123xyz",
  "contentType": "article",
  "title": "Title in Russian",
  "summaryHtml": "<h2>...</h2><p>...</p>",
  "fullHtml": "<h2>...</h2><p>...</p>",
  "date": "2025-01-15",
  "sourceName": "JAMA Dermatology",
  "sourceUrl": "https://...",
  "originalTitle": "Original Title",
  "originalUrl": "https://...",
  "authors": "Dr. Smith"
}
```

**Response:**
```json
{
  "success": true,
  "recordId": "recABC123xyz",
  "queryParam": "r=recABC123xyz",
  "cdnUrl": "https://cdn.etopodtema.com/recABC123xyz/summary.json"
}
```

**Deploy:**
```bash
cd publish-gcf
gcloud run deploy reader-publish \
  --region=europe-west1 \
  --source=.
```

## JSON Blob Format

Stored at `/{recordId}/summary.json`:

```json
{
  "t": "Title",
  "s": "<html>Summary</html>",
  "f": "<html>Full translation</html>",
  "y": "article",
  "d": "2025-01-15",
  "r": "recABC123xyz",
  "src": { "n": "Source Name", "u": "https://..." },
  "orig": { "t": "Original Title", "u": "https://..." },
  "a": "Authors"
}
```

| Key | Description |
|-----|-------------|
| `t` | Title (Russian) |
| `s` | Summary HTML |
| `f` | Full translation HTML (optional) |
| `y` | Type: article, podcast, guideline, digest |
| `d` | Date (YYYY-MM-DD) |
| `r` | Airtable record ID |
| `src` | Source info (optional) |
| `orig` | Original article info (optional) |
| `a` | Authors (optional) |

## Integration Flow

```
1. Packaging Automation
   ├── HTML content ready
   ├── Call Publish GCF with article data
   └── Store queryParam in Airtable ReaderLink field

2. Delivery Automation
   ├── Read ReaderLink from Airtable
   ├── Build URL: https://cdn.../reader/v1/?r={recordId}
   └── Send message with web_app button

3. User Opens
   ├── Mini app loads (cached)
   ├── Fetches /{recordId}/summary.json (cached)
   ├── Renders content with tabs
   └── Sends analytics event
```

## Environment Variables (GCF)

- `YandexKeyId` - Yandex Object Storage access key
- `YandexSecretAccessKey` - Yandex Object Storage secret
- `YandexBucketName` - Bucket name (default: podtema)
- `ApiKey` - API key for authentication
- `SrvcBotToken` - Telegram service bot for error notifications
