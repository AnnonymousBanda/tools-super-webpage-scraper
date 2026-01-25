// ============================================
// Service Worker for Super Webpage Scraper Extension
// Handles processing that persists when popup is closed
// ============================================

// ============================================
// State Management
// ============================================

// Per-tab operation tracking for concurrent scraping
const operationsByTabId = new Map();  // tabId => operation object
const operationTimeouts = new Map();  // tabId => timeout handle

const OPERATION_TIMEOUT_MS = 60000; // 60 seconds

// ============================================
// URL Validation
// ============================================

function validateUrl(url) {
  if (!url) {
    return { valid: false, error: 'No URL found. Please navigate to a webpage first.' };
  }

  const restrictedSchemes = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://', 'opera://', 'vivaldi://'];
  for (const scheme of restrictedSchemes) {
    if (url.startsWith(scheme)) {
      return { valid: false, error: 'Cannot convert browser internal pages. Navigate to a regular webpage.' };
    }
  }

  if (url.startsWith('file://')) {
    return { valid: false, error: 'Cannot convert local files. The page must be accessible via HTTP/HTTPS.' };
  }

  if (url.startsWith('data:')) {
    return { valid: false, error: 'Cannot convert data URLs. Navigate to a regular webpage.' };
  }

  if (url.startsWith('javascript:')) {
    return { valid: false, error: 'Cannot convert JavaScript URLs. Navigate to a regular webpage.' };
  }

  if (url.startsWith('view-source:')) {
    return { valid: false, error: 'Cannot convert view-source pages. Navigate to a regular webpage.' };
  }

  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS pages can be converted.' };
    }
  } catch (e) {
    return { valid: false, error: 'Invalid URL format. Navigate to a valid webpage.' };
  }

  return { valid: true };
}

// ============================================
// Timeout Management
// ============================================

function startOperationTimeout(tabId) {
  clearOperationTimeout(tabId);
  const timeoutHandle = setTimeout(() => {
    const operation = operationsByTabId.get(tabId);
    if (operation && operation.status !== 'completed' && operation.status !== 'error') {
      operation.status = 'timeout';
      operation.error = 'Operation timed out after 60 seconds. Please try again.';
      broadcastStatus(tabId);
      resetOperation(tabId);
    }
  }, OPERATION_TIMEOUT_MS);
  operationTimeouts.set(tabId, timeoutHandle);
}

function clearOperationTimeout(tabId) {
  const timeoutHandle = operationTimeouts.get(tabId);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    operationTimeouts.delete(tabId);
  }
}

// ============================================
// Status Broadcasting
// ============================================

// Safely send message to popup (if open)
async function broadcastStatus(tabId) {
  const operation = operationsByTabId.get(tabId);
  if (!operation) return;

  // In Manifest V3, chrome.extension.getViews() is deprecated
  // Use chrome.runtime.sendMessage directly and handle the error gracefully
  try {
    await chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      tabId: tabId,
      operation: operation
    });
  } catch (e) {
    // Expected error when no popup is open - "Could not establish connection"
    // This is normal behavior, not an error we need to handle
  }
}

function updateStatus(tabId, status, message) {
  const operation = operationsByTabId.get(tabId);
  if (operation) {
    operation.status = status;
    operation.message = message;
    broadcastStatus(tabId);
  }
}

// ============================================
// Image Fetch Handler (Bypasses CORS)
// ============================================

/**
 * Process a successful fetch response and convert to base64
 * @param {Response} response - The fetch response
 * @returns {Promise<{success: boolean, data: string, contentType: string, size: number}>}
 */
async function processImageResponse(response) {
  const blob = await response.blob();
  const contentType = response.headers.get('content-type') || blob.type || 'image/jpeg';

  // Verify it's actually an image (allow large non-image blobs in case content-type is wrong)
  if (!contentType.startsWith('image/') && blob.size < 100) {
    throw new Error('Response is not a valid image');
  }

  // Convert blob to base64 for transfer to content script
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        success: true,
        data: reader.result,
        contentType: contentType,
        size: blob.size
      });
    };
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch an image from the background script context
 * This bypasses CORS restrictions because background scripts
 * with host_permissions can fetch from any URL
 *
 * Uses a two-strategy approach:
 * 1. Simple fetch with self-referral (Referer = image's own origin)
 * 2. Fallback: fetch with no special headers
 *
 * @param {string} url - The image URL to fetch
 * @param {number} timeout - Timeout in ms
 * @param {string} pageReferer - Optional page URL for fallback
 */
async function fetchImageFromBackground(url, timeout = 10000, pageReferer = '') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Get the image's own origin for self-referral (many CDNs accept this)
  let imageOrigin = '';
  try {
    imageOrigin = new URL(url).origin;
  } catch (e) {
    // Invalid URL, continue without origin
  }

  // Common browser-like headers to avoid being blocked
  // NOTE: We intentionally EXCLUDE image/avif from Accept header because:
  // 1. jsPDF does NOT support AVIF format
  // 2. CDNs like Framer do content negotiation and serve AVIF when requested
  // 3. By not requesting AVIF, CDNs serve PNG/JPEG/WebP which jsPDF can handle
  // WebP is supported by jsPDF, PNG/JPEG are universally supported
  const browserHeaders = {
    'Accept': 'image/png,image/jpeg,image/webp,image/apng,image/svg+xml,image/*;q=0.8,*/*;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site'
  };

  // Strategy 1: Fetch with self-referral (Referer = image's origin)
  // This works for CDNs that check Referer for hotlink protection
  // but allow requests from their own domain
  if (imageOrigin) {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
        headers: {
          ...browserHeaders,
          'Referer': imageOrigin + '/'
        }
      });

      if (response.ok) {
        clearTimeout(timeoutId);
        return await processImageResponse(response);
      }
    } catch (e) {
      // Strategy 1 failed, try next
    }
  }

  // Strategy 2: Simple fetch with browser-like headers
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      headers: browserHeaders
    });

    if (response.ok) {
      clearTimeout(timeoutId);
      return await processImageResponse(response);
    }

    clearTimeout(timeoutId);
    return {
      success: false,
      error: `HTTP ${response.status}: ${response.statusText}`
    };

  } catch (error) {
    clearTimeout(timeoutId);

    let errorMessage = error.message;
    if (error.name === 'AbortError') {
      errorMessage = 'Image fetch timed out';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Network error - image server unreachable';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Batch fetch multiple images (more efficient for many images)
 *
 * @param {string[]} urls - Array of image URLs to fetch
 * @param {number} timeout - Timeout in ms
 * @param {string} referer - Optional referer URL for CDN compatibility
 */
async function fetchImagesFromBackground(urls, timeout = 10000, referer = '') {
  const results = {};

  // Process in parallel with concurrency limit
  const CONCURRENCY = 5;
  const chunks = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    chunks.push(urls.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (url) => {
      const result = await fetchImageFromBackground(url, timeout, referer);
      return { url, result };
    });

    const chunkResults = await Promise.all(promises);
    for (const { url, result } of chunkResults) {
      results[url] = result;
    }
  }

  return results;
}

// ============================================
// Download Handler
// ============================================

async function downloadFile(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

// ============================================
// Common Operation Handlers
// ============================================

/**
 * Format file size in human-readable format (KB or MB)
 * @param {number} sizeKB - Size in kilobytes
 * @returns {string} - Formatted size string (e.g., "512 KB" or "1.5 MB")
 */
function formatFileSize(sizeKB) {
  if (sizeKB >= 1024) {
    const sizeMB = (sizeKB / 1024).toFixed(1);
    // Remove trailing .0 for whole numbers
    return sizeMB.endsWith('.0') ? `${parseInt(sizeMB)} MB` : `${sizeMB} MB`;
  }
  return `${sizeKB} KB`;
}

/**
 * Maps error patterns to user-friendly messages
 */
const ERROR_MAPPINGS = {
  access: {
    patterns: ['Cannot access', 'Cannot read', 'No tab'],
    message: 'Cannot access this page. Please refresh and try again, or try a different webpage.'
  },
  script: {
    patterns: ['Script execution failed', 'No frame with id'],
    messages: {
      markdown: 'Could not run on this page. Try refreshing the page or use a different article.',
      pdf: 'Could not generate PDF on this page. Try refreshing or use a different article.',
      images: 'Could not extract images from this page. Try refreshing or use a different article.'
    }
  },
  timeout: {
    patterns: ['timeout', 'Timeout'],
    messages: {
      markdown: 'Operation timed out. The page may be too large. Try a shorter article.',
      pdf: 'PDF generation timed out. The article may be too long. Try a shorter article.',
      images: 'Image extraction timed out. Try again or use a page with fewer images.'
    }
  },
  memory: {
    patterns: ['memory', 'Memory'],
    message: 'Not enough memory. Try closing other tabs and retry.'
  },
  cors: {
    patterns: ['CORS', 'cross-origin'],
    message: 'Some images could not be downloaded due to server restrictions (CORS).'
  }
};

/**
 * Get user-friendly error message based on error type and operation
 */
function getErrorMessage(error, operationType) {
  const errorMsg = error.message || '';

  for (const [, mapping] of Object.entries(ERROR_MAPPINGS)) {
    const matches = mapping.patterns.some(p => errorMsg.includes(p));
    if (matches) {
      // Return type-specific message if available, otherwise generic
      if (mapping.messages) {
        return mapping.messages[operationType] || mapping.messages.markdown;
      }
      return mapping.message;
    }
  }

  return errorMsg;
}

/**
 * Handle operation error and update state
 */
function handleOperationError(error, tabId, operationType) {
  const errorMessage = getErrorMessage(error, operationType);

  const operation = operationsByTabId.get(tabId);
  if (operation) {
    operation.status = 'error';
    operation.error = errorMessage;
    operation.message = errorMessage;
    broadcastStatus(tabId);
  }
  resetOperation(tabId);
}

/**
 * Handle successful operation completion
 */
function handleOperationSuccess(tabId, result, operationType) {
  const operation = operationsByTabId.get(tabId);
  if (!operation) return;

  operation.status = 'completed';
  operation.result = {
    filename: result.filename,
    stats: result.stats
  };

  // Build success message based on operation type
  let successMsg = `Downloaded: ${result.filename}`;

  if (operationType === 'markdown' && result.stats) {
    const imgInfo = result.stats.imagesDownloaded > 0
      ? ` (${result.stats.imagesDownloaded} images)`
      : ' (no images)';
    successMsg += imgInfo;
    if (result.stats.imagesFailed > 0) {
      successMsg += ` - ${result.stats.imagesFailed} images failed`;
    }
  } else if (operationType === 'pdf' && result.stats) {
    successMsg += ` (${formatFileSize(result.stats.sizeKB)})`;
    if (result.stats.imagesFailed > 0) {
      successMsg += ` - ${result.stats.imagesFailed} images skipped`;
    }
  } else if (operationType === 'images' && result.stats) {
    successMsg += ` (${formatFileSize(result.stats.sizeKB)}, ${result.stats.imagesDownloaded} images)`;
    if (result.stats.imagesFailed > 0) {
      successMsg += ` - ${result.stats.imagesFailed} failed`;
    }
  }

  operation.message = successMsg;
  broadcastStatus(tabId);
  resetOperation(tabId);
}

/**
 * Inject libraries into a tab
 */
async function injectLibraries(tabId, libraries) {
  for (const lib of libraries) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [lib]
    });
  }
}

/**
 * Execute content script and get result
 */
async function executeContentScript(tabId, scriptFile) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: [scriptFile]
  });

  if (!results || results.length === 0 || !results[0].result) {
    throw new Error('Script execution failed. Please try again.');
  }

  return results[0].result;
}

// ============================================
// Markdown Conversion
// ============================================

async function convertToMarkdown(tabId, tabUrl) {
  startOperation('markdown', tabId);

  try {
    // Validate URL
    const urlCheck = validateUrl(tabUrl);
    if (!urlCheck.valid) {
      throw new Error(urlCheck.error);
    }

    // Inject libraries
    updateStatus(tabId, 'injecting', 'Loading libraries...');
    await injectLibraries(tabId, [
      'lib/lazy-scroll.js',      // Must be first - provides triggerLazyLoading()
      'lib/image-fetcher.js',    // Shared image fetching (CORS bypass)
      'lib/Readability.js',
      'lib/turndown.js',
      'lib/turndown-plugin-gfm.js',
      'lib/jszip.min.js'
    ]);

    // Execute content script
    updateStatus(tabId, 'processing', 'Extracting content...');
    const result = await executeContentScript(tabId, 'content-script.js');

    if (!result.success) {
      throw new Error(result.error || 'Failed to extract article content.');
    }

    // Download the file
    updateStatus(tabId, 'downloading', 'Downloading ZIP...');
    await downloadFile(result.zipData, result.filename);

    // Handle success
    handleOperationSuccess(tabId, result, 'markdown');

  } catch (error) {
    handleOperationError(error, tabId, 'markdown');
  }
}

// ============================================
// PDF Conversion
// ============================================

async function convertToPDF(tabId, tabUrl) {
  startOperation('pdf', tabId);

  try {
    // Validate URL
    const urlCheck = validateUrl(tabUrl);
    if (!urlCheck.valid) {
      throw new Error(urlCheck.error);
    }

    // Inject libraries
    updateStatus(tabId, 'injecting', 'Loading PDF libraries...');
    await injectLibraries(tabId, [
      'lib/lazy-scroll.js',
      'lib/image-fetcher.js',    // Shared image fetching (CORS bypass)
      'lib/Readability.js',
      'lib/jspdf.umd.min.js'
    ]);

    // Execute content script
    updateStatus(tabId, 'processing', 'Generating PDF...');
    const result = await executeContentScript(tabId, 'content-script-pdf.js');

    if (!result.success) {
      throw new Error(result.error || 'Failed to generate PDF.');
    }

    // Download the file
    updateStatus(tabId, 'downloading', 'Downloading PDF...');
    await downloadFile(result.pdfData, result.filename);

    // Handle success
    handleOperationSuccess(tabId, result, 'pdf');

  } catch (error) {
    handleOperationError(error, tabId, 'pdf');
  }
}

// ============================================
// Images Extraction
// ============================================

async function extractImages(tabId, tabUrl) {
  startOperation('images', tabId);

  try {
    // Validate URL
    const urlCheck = validateUrl(tabUrl);
    if (!urlCheck.valid) {
      throw new Error(urlCheck.error);
    }

    // Inject libraries
    updateStatus(tabId, 'injecting', 'Loading libraries...');
    await injectLibraries(tabId, [
      'lib/lazy-scroll.js',      // Must be first - provides triggerLazyLoading()
      'lib/image-fetcher.js',    // Shared image fetching (CORS bypass)
      'lib/Readability.js',
      'lib/jszip.min.js'
    ]);

    // Execute content script
    updateStatus(tabId, 'processing', 'Extracting images...');
    const result = await executeContentScript(tabId, 'content-script-images.js');

    if (!result.success) {
      throw new Error(result.error || 'Failed to extract images.');
    }

    // Download the file
    updateStatus(tabId, 'downloading', 'Downloading images...');
    await downloadFile(result.zipData, result.filename);

    // Handle success
    handleOperationSuccess(tabId, result, 'images');

  } catch (error) {
    handleOperationError(error, tabId, 'images');
  }
}

// ============================================
// Message Handlers
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle messages from popup
  if (message.type === 'START_CONVERSION') {
    const { conversionType, tabId, tabUrl } = message;

    // Check if THIS TAB already has an operation running
    const existingOp = operationsByTabId.get(tabId);
    if (existingOp &&
        existingOp.status !== 'completed' &&
        existingOp.status !== 'error' &&
        existingOp.status !== 'timeout') {
      sendResponse({
        success: false,
        error: 'A conversion is already running on this tab.'
      });
      return true;
    }

    // Start the conversion (other tabs can run concurrently)
    console.log('Starting conversion:', conversionType, tabId);
    if (conversionType === 'markdown') {
      convertToMarkdown(tabId, tabUrl);
    } else if (conversionType === 'pdf') {
      convertToPDF(tabId, tabUrl);
    } else if (conversionType === 'images') {
      extractImages(tabId, tabUrl);
    } else {
      console.log('Unknown conversion type:', conversionType);
    }

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    const { tabId } = message;
    const operation = tabId ? operationsByTabId.get(tabId) : null;
    sendResponse({ operation: operation || null });
    return true;
  }

  if (message.type === 'CANCEL_OPERATION') {
    const { tabId } = message;
    const operation = operationsByTabId.get(tabId);
    if (operation) {
      operation.status = 'error';
      operation.error = 'Operation cancelled.';
      operation.message = 'Operation cancelled.';
      broadcastStatus(tabId);
      resetOperation(tabId);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CHECK_READABILITY') {
    const { tabId, tabUrl } = message;

    (async () => {
      try {
        // Inject the article detection library
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['lib/article-detector.js']
        });

        // Execute the detection
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (url) => {
            if (typeof detectArticle === 'function') {
              return detectArticle(document, url);
            }
            return { isArticle: true, confidence: 0, reason: 'Detection unavailable' };
          },
          args: [tabUrl]
        });

        const detection = results && results[0] && results[0].result;
        if (detection) {
          sendResponse({
            success: true,
            isReaderable: detection.isArticle,
            confidence: detection.confidence,
            reason: detection.reason,
            score: detection.score,
            signals: detection.signals
          });
        } else {
          sendResponse({ success: true, isReaderable: true });
        }
      } catch (error) {
        // Fail open - allow user to try
        sendResponse({ success: true, isReaderable: true });
      }
    })();

    return true;
  }

  // ============================================
  // Image Fetch Handlers (for CORS bypass)
  // ============================================

  // Single image fetch - used by content scripts to bypass CORS
  if (message.type === 'FETCH_IMAGE') {
    const { url, referer } = message;

    if (!url) {
      sendResponse({ success: false, error: 'No URL provided' });
      return true;
    }

    // Skip data URLs - they don't need fetching
    if (url.startsWith('data:')) {
      sendResponse({ success: false, error: 'Data URLs should be handled directly' });
      return true;
    }

    // Perform the fetch asynchronously (pass referer for CDN compatibility)
    (async () => {
      try {
        const result = await fetchImageFromBackground(url, 10000, referer || '');
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep channel open for async response
  }

  // Batch image fetch - more efficient for multiple images
  if (message.type === 'FETCH_IMAGES_BATCH') {
    const { urls, referer } = message;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      sendResponse({ success: false, error: 'No URLs provided' });
      return true;
    }

    // Filter out data URLs
    const httpUrls = urls.filter(url => !url.startsWith('data:'));

    if (httpUrls.length === 0) {
      sendResponse({ success: true, results: {} });
      return true;
    }

    // Perform batch fetch asynchronously (pass referer for CDN compatibility)
    (async () => {
      try {
        const results = await fetchImagesFromBackground(httpUrls, 10000, referer || '');
        sendResponse({ success: true, results });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep channel open for async response
  }

  // Always return false for unhandled messages
  return false;
});

// ============================================
// Service Worker Keep-Alive (for long operations)
// ============================================

// Manifest V3 service workers can be terminated after 30 seconds of inactivity
// We use chrome.alarms to keep the worker alive during operations
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('keepAlive_')) {
    const tabId = parseInt(alarm.name.replace('keepAlive_', ''), 10);
    const operation = operationsByTabId.get(tabId);
    if (!operation) {
      chrome.alarms.clear(alarm.name);
      return;
    }
    // Check if operation is still running
    const runningStatuses = ['starting', 'injecting', 'processing', 'downloading'];
    if (!runningStatuses.includes(operation.status)) {
      chrome.alarms.clear(alarm.name);
    }
  }
});

function startKeepAlive(tabId) {
  chrome.alarms.create(`keepAlive_${tabId}`, { periodInMinutes: 0.4 }); // ~24 seconds
}

function stopKeepAlive(tabId) {
  chrome.alarms.clear(`keepAlive_${tabId}`);
}

// Reset operation state and stop timers
function resetOperation(tabId) {
  clearOperationTimeout(tabId);
  stopKeepAlive(tabId);
  // Keep the final state briefly so popup can show result
  setTimeout(() => {
    const operation = operationsByTabId.get(tabId);
    if (operation && (operation.status === 'completed' ||
        operation.status === 'error' || operation.status === 'timeout')) {
      operationsByTabId.delete(tabId);
    }
  }, 5000);
}

// Start a new operation with keep-alive and timeout
function startOperation(type, tabId) {
  const operation = {
    type,
    tabId,
    status: 'starting',
    message: 'Starting...',
    startTime: Date.now(),
    result: null,
    error: null
  };
  operationsByTabId.set(tabId, operation);
  startKeepAlive(tabId);
  startOperationTimeout(tabId);
  broadcastStatus(tabId);
}

// Log that service worker is ready
console.log('Super Webpage Scraper service worker initialized');
