/**
 * Shared Image Fetcher Library
 * Provides CORS-bypassing image fetching for all content scripts
 * Uses background script with host_permissions to fetch cross-origin images
 */

(function() {
  'use strict';

  // Configuration
  const IMAGE_FETCH_TIMEOUT = 10000; // 10 seconds per image

  // Accept header that excludes AVIF - jsPDF doesn't support AVIF
  // CDNs like Framer do content negotiation; by not requesting AVIF, they serve PNG/JPEG/WebP
  const IMAGE_ACCEPT_HEADER = 'image/png,image/jpeg,image/webp,image/apng,image/svg+xml,image/*;q=0.8';

  /**
   * Get the current page URL for use as referer
   * @returns {string} - The page URL
   */
  function getPageUrl() {
    try {
      return window.location.href;
    } catch (e) {
      return '';
    }
  }

  /**
   * Fetch image via background script (bypasses CORS)
   * The background script has host_permissions and can fetch from any URL
   *
   * @param {string} url - The image URL to fetch
   * @param {string} referer - The referer URL (page URL) for CDN compatibility
   * @returns {Promise<{data: string, contentType: string, size: number}>} - Base64 data URL
   */
  async function fetchImageViaBackground(url, referer = '') {
    return new Promise((resolve, reject) => {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Chrome runtime not available'));
        return;
      }

      // Use provided referer or get from current page
      const pageReferer = referer || getPageUrl();

      chrome.runtime.sendMessage(
        { type: 'FETCH_IMAGE', url: url, referer: pageReferer },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            reject(new Error('No response from background script'));
            return;
          }

          if (response.success) {
            resolve({
              data: response.data,
              contentType: response.contentType,
              size: response.size
            });
          } else {
            reject(new Error(response.error || 'Background fetch failed'));
          }
        }
      );
    });
  }

  /**
   * Convert base64 data URL to Blob
   *
   * @param {string} dataUrl - Base64 data URL
   * @returns {{blob: Blob, contentType: string}|null}
   */
  function dataURLtoBlob(dataUrl) {
    try {
      const parts = dataUrl.split(',');
      if (parts.length < 2) return null;

      const mimeMatch = parts[0].match(/:(.*?);/);
      if (!mimeMatch) return null;

      const mime = mimeMatch[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);

      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }

      return {
        blob: new Blob([u8arr], { type: mime }),
        contentType: mime
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Try direct fetch first (faster for same-origin), fall back to background fetch
   * Returns a Blob - suitable for Markdown and Images export
   *
   * @param {string} url - The image URL to fetch
   * @param {number} timeout - Timeout in ms (default 10000)
   * @returns {Promise<{blob: Blob, contentType: string}>}
   */
  async function fetchImageAsBlob(url, timeout = IMAGE_FETCH_TIMEOUT) {
    // Handle data URLs directly
    if (url.startsWith('data:')) {
      const result = dataURLtoBlob(url);
      if (result) return result;
      throw new Error('Invalid data URL');
    }

    // Strategy 1: Try direct fetch (works for same-origin and CORS-enabled images)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': IMAGE_ACCEPT_HEADER  // Exclude AVIF for jsPDF compatibility
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const blob = await response.blob();
        const contentType = response.headers.get('content-type') || blob.type || 'image/jpeg';

        if (blob.size > 0) {
          return { blob, contentType };
        }
      }
    } catch (directError) {
      clearTimeout(timeoutId);
      // Direct fetch failed (likely CORS) - continue to background fetch
    }

    // Strategy 2: Fetch via background script (bypasses CORS)
    // Pass page URL as referer for CDN compatibility (framerusercontent, etc.)
    try {
      const result = await fetchImageViaBackground(url, getPageUrl());
      const blobResult = dataURLtoBlob(result.data);

      if (blobResult) {
        return blobResult;
      }
      throw new Error('Failed to convert fetched data to blob');
    } catch (bgError) {
      throw new Error(`Failed to fetch image: ${bgError.message}`);
    }
  }

  /**
   * Try direct fetch first, fall back to background fetch
   * Returns base64 data URL - suitable for PDF export
   *
   * @param {string} url - The image URL to fetch
   * @param {number} timeout - Timeout in ms (default 10000)
   * @returns {Promise<string|null>} - Base64 data URL or null on failure
   */
  async function fetchImageAsBase64(url, timeout = IMAGE_FETCH_TIMEOUT) {
    // Handle data URLs directly
    if (!url) return null;
    if (url.startsWith('data:')) return url;

    // Strategy 1: Try direct fetch (works for same-origin and CORS-enabled images)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Match fetchImageAsBlob exactly (which works for Save All Images)
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': IMAGE_ACCEPT_HEADER  // Exclude AVIF for jsPDF compatibility
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const blob = await response.blob();
        const contentType = response.headers.get('content-type') || blob.type || 'image/jpeg';

        if (blob.size > 0) {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch (directError) {
      clearTimeout(timeoutId);
      // Direct fetch failed - continue to background fetch
    }

    // Strategy 2: Fetch via background script (bypasses CORS)
    // Pass page URL as referer for CDN compatibility (framerusercontent, etc.)
    try {
      const result = await fetchImageViaBackground(url, getPageUrl());

      // Validate the result
      if (result.size < 100) return null; // Skip tiny images

      return result.data;
    } catch (bgError) {
      return null;
    }
  }

  /**
   * Load image via Image element and canvas (last resort fallback)
   * This can work for some images that allow display but not fetch
   * Note: Canvas will be "tainted" for cross-origin images without CORS headers
   *
   * @param {string} url - The image URL to load
   * @param {number} timeout - Timeout in ms (default 10000)
   * @returns {Promise<string|null>} - Base64 data URL or null on failure
   */
  async function loadImageViaCanvas(url, timeout = IMAGE_FETCH_TIMEOUT) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const timeoutHandle = setTimeout(() => {
        resolve(null);
      }, timeout);

      img.onload = () => {
        clearTimeout(timeoutHandle);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          // Canvas is tainted - can't extract data
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timeoutHandle);
        resolve(null);
      };

      img.src = url;
    });
  }

  /**
   * Fetch image with all fallback strategies
   * Order matches Save All Images (which works reliably):
   * 1. Direct fetch (works for same-origin and CORS-enabled)
   * 2. Background fetch (bypasses CORS via extension permissions)
   * 3. Canvas method (last resort for edge cases)
   *
   * @param {string} url - The image URL to fetch
   * @param {number} timeout - Timeout in ms (default 10000)
   * @returns {Promise<string|null>} - Base64 data URL or null on failure
   */
  async function fetchImageWithFallbacks(url, timeout = IMAGE_FETCH_TIMEOUT) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;

    // Strategy 1 & 2: Try fetch methods first (direct + background)
    // This matches the Save All Images flow which works reliably
    let result = await fetchImageAsBase64(url, timeout);
    if (result) return result;

    // Strategy 3: Canvas method as last resort
    result = await loadImageViaCanvas(url, timeout);
    if (result) return result;

    return null;
  }

  /**
   * Get file extension from URL or content type
   *
   * @param {string} url - The image URL
   * @param {string} contentType - The content type
   * @returns {string} - File extension (e.g., 'jpg', 'png')
   */
  function getImageExtension(url, contentType) {
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
      'image/avif': 'avif',
      'image/x-icon': 'ico',
      'image/vnd.microsoft.icon': 'ico'
    };

    // Try content type first
    if (contentType) {
      const mime = contentType.split(';')[0].trim();
      if (mimeToExt[mime]) {
        return mimeToExt[mime];
      }
    }

    // Try to extract from URL
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        const ext = match[1].toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'avif', 'ico'].includes(ext)) {
          return ext === 'jpeg' ? 'jpg' : ext;
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }

    return 'jpg'; // Default fallback
  }

  /**
   * Resolve a potentially relative URL to absolute
   *
   * @param {string} src - The source URL (may be relative)
   * @param {string} baseUrl - The base URL for resolution
   * @returns {string|null} - Absolute URL or null if invalid
   */
  function resolveImageUrl(src, baseUrl) {
    if (!src) return null;
    if (src.startsWith('data:')) return src;
    try {
      return new URL(src, baseUrl).href;
    } catch (e) {
      return null;
    }
  }

  // Export functions to global scope for use by content scripts
  window.ImageFetcher = {
    fetchImageViaBackground,
    fetchImageAsBlob,
    fetchImageAsBase64,
    loadImageViaCanvas,
    fetchImageWithFallbacks,
    dataURLtoBlob,
    getImageExtension,
    resolveImageUrl,
    getPageUrl,
    IMAGE_FETCH_TIMEOUT
  };

})();
