# Reader Publish GCF

Google Cloud Function for publishing article summaries to CDN for the Podtema Reader Mini App.

## Purpose

Accepts article content (title, summary HTML, full translation HTML, metadata) and uploads it as a JSON blob to Yandex Object Storage CDN. Returns a query parameter for use in Telegram Mini App URLs.

## Endpoint

`POST /publishSummary`

### Authentication

Requires `X-API-Key` header with valid API key.

### Request Body

```json
{
  "recordId": "recABC123xyz",
  "contentType": "article",
  "title": "Атопический дерматит: рекомендации AAD 2024",
  "summaryHtml": "<h2>Определение</h2><p>...</p>",
  "fullHtml": "<h2>Введение</h2><p>...</p>",
  "date": "2025-01-15",
  "sourceName": "JAMA Dermatology",
  "sourceUrl": "https://jamanetwork.com/...",
  "originalTitle": "Atopic Dermatitis Guidelines 2024",
  "originalUrl": "https://...",
  "authors": "Dr. Smith et al."
}
```

**Required fields:**
- `recordId` - Airtable record ID
- `contentType` - One of: `article`, `podcast`, `guideline`, `digest`
- `title` - Russian title
- `summaryHtml` - Summary HTML content
- `date` - Publication date (YYYY-MM-DD)

**Optional fields:**
- `fullHtml` - Full translation HTML
- `sourceName` - Source journal/podcast name
- `sourceUrl` - Source URL
- `originalTitle` - Original article title
- `originalUrl` - Original article URL
- `authors` - Author names

### Response

```json
{
  "success": true,
  "recordId": "recABC123xyz",
  "queryParam": "r=recABC123xyz",
  "cdnUrl": "https://cdn.etopodtema.com/recABC123xyz/summary.json",
  "size": 15234,
  "duration": "245ms"
}
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
  "src": { "n": "JAMA Dermatology", "u": "https://..." },
  "orig": { "t": "Original Title", "u": "https://..." },
  "a": "Dr. Smith et al."
}
```

| Key | Description |
|-----|-------------|
| `t` | Title |
| `s` | Summary HTML |
| `f` | Full translation HTML (optional) |
| `y` | Content type |
| `d` | Date |
| `r` | Record ID |
| `src` | Source info (optional) |
| `orig` | Original article info (optional) |
| `a` | Authors (optional) |

## Idempotency

If content for a recordId already exists, the function returns success with `skipped: true` without re-uploading.

## Environment Variables

- `YandexKeyId` - Yandex Object Storage access key
- `YandexSecretAccessKey` - Yandex Object Storage secret key
- `YandexBucketName` - Bucket name (default: podtema-cdn)
- `ApiKey` - API key for authentication
- `SrvcBotToken` - Telegram service bot token for error notifications

## Deployment

```bash
gcloud run deploy reader-publish \
  --region=europe-west1 \
  --source=/tmp/reader-publish
```
