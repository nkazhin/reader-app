const functions = require('@google-cloud/functions-framework');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Yandex Object Storage settings
const YANDEX_ACCESS_KEY_ID = process.env.YandexKeyId;
const YANDEX_SECRET_ACCESS_KEY = process.env.YandexSecretAccessKey;
const YANDEX_BUCKET_NAME = process.env.YandexBucketName || 'podtema-cdn';
const YANDEX_REGION = 'ru-central1';
const YANDEX_ENDPOINT = 'https://storage.yandexcloud.net';

// CDN settings
const CDN_BASE_URL = 'https://cdn.etopodtema.com';

// API Key for authentication
const API_KEY = process.env.ApiKey;

// Admin notification settings
const SERVICE_BOT_TOKEN = process.env.SrvcBotToken;
const ADMIN_TELEGRAM_ID = '234524401';

// Initialize S3 client for Yandex Object Storage
const s3Client = new S3Client({
  region: YANDEX_REGION,
  endpoint: YANDEX_ENDPOINT,
  credentials: {
    accessKeyId: YANDEX_ACCESS_KEY_ID,
    secretAccessKey: YANDEX_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

// Logging utility
function log(message, level = 'info', context = {}) {
  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0 ? ` | ${JSON.stringify(context)}` : '';
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`);
}

// Send error notification to admin
async function sendErrorNotification(errorMessage, context = {}) {
  try {
    if (!SERVICE_BOT_TOKEN) {
      log('Service bot token not available, skipping notification', 'warn');
      return;
    }

    const endpoint = `https://api.telegram.org/bot${SERVICE_BOT_TOKEN}/sendMessage`;
    const contextStr = Object.keys(context).length > 0
      ? `\n\nContext: ${JSON.stringify(context, null, 2)}`
      : '';
    const text = `🚨 Reader Publish GCF Error:\n\n${errorMessage}${contextStr}`;

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_TELEGRAM_ID,
        text: text.slice(0, 4096),
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    log(`Failed to send error notification: ${e.message}`, 'error');
  }
}

// Check if object already exists in S3
async function objectExists(key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: YANDEX_BUCKET_NAME,
      Key: key
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

// Upload JSON to Yandex Object Storage
async function uploadJson(key, jsonData, recordId) {
  const jsonString = JSON.stringify(jsonData);
  const buffer = Buffer.from(jsonString, 'utf-8');

  const uploadParams = {
    Bucket: YANDEX_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'public, max-age=86400', // 24 hours
    Metadata: {
      'record-id': recordId,
      'content-type': 'reader-summary'
    }
  };

  const command = new PutObjectCommand(uploadParams);
  const result = await s3Client.send(command);

  log(`Upload successful`, 'info', { key, size: buffer.length, etag: result.ETag });

  return {
    success: true,
    key: key,
    url: `${CDN_BASE_URL}/${key}`,
    size: buffer.length,
    etag: result.ETag
  };
}

// Validate required fields
function validateInput(body) {
  const required = ['recordId', 'contentType', 'title', 'summaryHtml', 'date'];
  const missing = required.filter(field => !body[field]);

  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  const validContentTypes = ['article', 'podcast', 'guideline', 'digest'];
  if (!validContentTypes.includes(body.contentType)) {
    return { valid: false, error: `Invalid contentType. Must be one of: ${validContentTypes.join(', ')}` };
  }

  return { valid: true };
}

// Build compact JSON blob for storage
function buildJsonBlob(body) {
  const blob = {
    t: body.title,                    // title
    s: body.summaryHtml,              // summary HTML
    y: body.contentType,              // type (article/podcast/guideline/digest)
    d: body.date,                     // date (YYYY-MM-DD)
    r: body.recordId                  // Airtable record ID
  };

  // Optional: full translation HTML (accept both field names for compatibility)
  if (body.translationHtml || body.fullHtml) {
    blob.f = body.translationHtml || body.fullHtml;
  }

  // Optional: source info
  if (body.sourceName) {
    blob.src = {
      n: body.sourceName
    };
    if (body.sourceUrl) {
      blob.src.u = body.sourceUrl;
    }
  }

  // Optional: original article info
  if (body.originalTitle) {
    blob.orig = {
      t: body.originalTitle
    };
    if (body.originalUrl) {
      blob.orig.u = body.originalUrl;
    }
  }

  // Optional: authors
  if (body.authors) {
    blob.a = body.authors;
  }

  return blob;
}

// Main function handler
functions.http('publishSummary', async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
    return;
  }

  // Authenticate
  const apiKey = req.headers['x-api-key'];
  if (!API_KEY || apiKey !== API_KEY) {
    log('Authentication failed', 'warn', { providedKey: apiKey ? 'present' : 'missing' });
    res.status(401).json({ success: false, error: 'Unauthorized. Invalid or missing API key.' });
    return;
  }

  const startTime = Date.now();
  let recordId = 'unknown';

  try {
    const body = req.body;
    recordId = body.recordId || 'unknown';

    log(`Processing publish request`, 'info', { recordId, contentType: body.contentType });

    // Validate input
    const validation = validateInput(body);
    if (!validation.valid) {
      log(`Validation failed: ${validation.error}`, 'warn', { recordId });
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    // Build the JSON blob
    const jsonBlob = buildJsonBlob(body);
    const objectKey = `${recordId}/summary.json`;

    // Check if already exists (idempotency)
    const exists = await objectExists(objectKey);
    if (exists) {
      log(`Object already exists, skipping upload`, 'info', { recordId, objectKey });

      const duration = Date.now() - startTime;
      res.status(200).json({
        success: true,
        skipped: true,
        message: 'Content already exists',
        recordId: recordId,
        queryParam: `r=${recordId}`,
        cdnUrl: `${CDN_BASE_URL}/${objectKey}`,
        duration: `${duration}ms`
      });
      return;
    }

    // Upload to Yandex Object Storage
    const uploadResult = await uploadJson(objectKey, jsonBlob, recordId);

    const duration = Date.now() - startTime;
    log(`Publish complete`, 'info', { recordId, duration: `${duration}ms`, size: uploadResult.size });

    res.status(200).json({
      success: true,
      recordId: recordId,
      queryParam: `r=${recordId}`,
      cdnUrl: uploadResult.url,
      size: uploadResult.size,
      duration: `${duration}ms`
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    log(`Error: ${error.message}`, 'error', { recordId, stack: error.stack });

    // Send admin notification
    await sendErrorNotification(error.message, { recordId, duration: `${duration}ms` });

    res.status(500).json({
      success: false,
      error: error.message,
      recordId: recordId,
      duration: `${duration}ms`
    });
  }
});
