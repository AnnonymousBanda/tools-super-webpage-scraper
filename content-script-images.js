// Content script for extracting images only from article
// This runs in the page context after libraries are injected

(async function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const MAX_FILENAME_LENGTH = 100;

  // Use shared ImageFetcher library (injected before this script)
  const {
    fetchImageAsBlob,
    dataURLtoBlob,
    getImageExtension,
    resolveImageUrl
  } = window.ImageFetcher || {};

  // ============================================
  // Utility Functions
  // ============================================

  function sanitizeFilename(name) {
    if (!name || name.trim() === '') {
      return 'untitled-' + Date.now();
    }
    let sanitized = name.replace(/[/\\:*?"<>|#%&{}$!'@+`=]/g, '');
    sanitized = sanitized.replace(/[\s_]+/g, '-');
    sanitized = sanitized.replace(/^[-\s]+|[-\s]+$/g, '');
    if (sanitized.length > MAX_FILENAME_LENGTH) {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH).replace(/-+$/, '');
    }
    return sanitized || 'untitled-' + Date.now();
  }

  // Extract best image URL from an img element (handles lazy loading patterns)
  function getImageUrl(img) {
    // First check the direct src property (most reliable for loaded images)
    if (img.src && img.src.length > 10 && !img.src.startsWith('data:image/svg')) {
      // Skip tiny placeholder data URIs
      if (img.src.startsWith('data:') && img.src.length < 200) {
        // Continue to check attributes
      } else {
        return img.src;
      }
    }

    // Check currentSrc (for responsive images with srcset)
    if (img.currentSrc && img.currentSrc.length > 10 && !img.currentSrc.startsWith('data:image/svg')) {
      if (!(img.currentSrc.startsWith('data:') && img.currentSrc.length < 200)) {
        return img.currentSrc;
      }
    }

    // Priority order for attribute-based sources (for lazy loading)
    const srcAttributes = [
      'src',
      'data-src',
      'data-lazy-src',
      'data-original',
      'data-src-medium',
      'data-src-large',
      'data-hi-res-src',
      'data-full-src',
      'data-image',
      'data-url',
      'data-lazy',
      'data-original-src'
    ];

    for (const attr of srcAttributes) {
      const value = img.getAttribute(attr);
      if (value && !value.startsWith('data:image/svg') && value.length > 10) {
        // Skip tiny placeholder data URIs but allow real ones
        if (value.startsWith('data:') && value.length < 200) continue;
        return value;
      }
    }

    // Check srcset for highest resolution image
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (srcset) {
      const sources = srcset.split(',').map(s => s.trim());
      // Get the last (usually highest resolution) source
      const lastSource = sources[sources.length - 1];
      const url = lastSource.split(/\s+/)[0];
      if (url && url.length > 10) return url;
    }

    return null;
  }

  // Find images in original document with fallback containers
  function findImagesInDocument(doc) {
    const images = new Set();

    // Common article content selectors (in priority order)
    const articleSelectors = [
      'article',
      '[role="article"]',
      'main',
      '[role="main"]',
      '.article-content',
      '.article-body',
      '.post-content',
      '.post-body',
      '.entry-content',
      '.content-body',
      '.story-body',
      '.blog-content',
      '.blog-post',
      // LinkedIn specific
      '.article__content',
      '.reader-article-content',
      '.feed-shared-article__content',
      '[data-test-id="article-content"]',
      '.lithograph-app',           // LinkedIn blog main container
      '[class*="article-cover"]',  // LinkedIn article covers
      '[class*="blog-"]',          // LinkedIn blog containers
      // Medium
      '.meteredContent',
      // Generic content areas
      '#content',
      '#main-content',
      '.main-content',
      '.page-content'
    ];

    // Try to find images in article containers first
    for (const selector of articleSelectors) {
      try {
        const containers = doc.querySelectorAll(selector);
        for (const container of containers) {
          const imgs = container.querySelectorAll('img');
          imgs.forEach(img => images.add(img));
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }

    // If no/few images found in article containers, try direct image selectors
    if (images.size < 2) {
      // Look for images with content-related classes
      const contentImageSelectors = [
        // LinkedIn specific - be very explicit
        'img.standalone-image-component__image',
        'img[class*="standalone-image"]',
        'img[class*="image-component"]',
        'img[class*="article-cover"]',
        'img[class*="lazy-loaded"]',
        // Generic article patterns
        'img[class*="article"]',
        'img[class*="content"]',
        'img[class*="post"]',
        'img[class*="story"]',
        'img[class*="blog"]',
        'img[class*="featured"]',
        'img[class*="hero"]',
        'img[class*="cover"]',
        'img[class*="thumbnail"]',
        'img[data-test-id]',
        // Structural selectors
        'figure img',
        'picture img',
        '[class*="image-container"] img',
        '[class*="media-container"] img',
        '[class*="figure"] img'
      ];

      for (const selector of contentImageSelectors) {
        try {
          const imgs = doc.querySelectorAll(selector);
          imgs.forEach(img => images.add(img));
        } catch (e) {
          // Invalid selector, skip
        }
      }
    }

    return Array.from(images);
  }

  // Filter out non-content images (avatars, icons, logos, ads)
  function isContentImage(img, url) {
    // Skip tiny images (likely icons)
    const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
    const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
    if ((width > 0 && width < 50) || (height > 0 && height < 50)) {
      return false;
    }

    // Skip based on class/id patterns
    const classAndId = (img.className || '') + ' ' + (img.id || '');
    const skipPatterns = /avatar|icon|logo|emoji|badge|button|nav|menu|sprite|tracking|pixel|ad-|ads-|advertisement/i;
    if (skipPatterns.test(classAndId)) {
      return false;
    }

    // Skip based on URL patterns
    const urlLower = (url || '').toLowerCase();
    const skipUrlPatterns = /avatar|icon|logo|emoji|badge|sprite|tracking|pixel|\.gif\?|1x1|spacer|blank\./i;
    if (skipUrlPatterns.test(urlLower)) {
      return false;
    }

    // Skip very small data URIs (likely placeholders)
    if (url && url.startsWith('data:') && url.length < 500) {
      return false;
    }

    return true;
  }

  // ============================================
  // Main Extraction Logic
  // ============================================

  try {
    // Check if required libraries are loaded
    if (typeof Readability === 'undefined') {
      throw new Error('Readability library not loaded');
    }
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded');
    }
    if (!window.ImageFetcher) {
      throw new Error('ImageFetcher library not loaded');
    }

    // Scroll through page to trigger lazy-loaded images (uses shared library)
    if (typeof triggerLazyLoading === 'function') {
      await triggerLazyLoading();
    }

    // Now clone the document (after lazy images have loaded)
    const documentClone = document.cloneNode(true);
    const baseUrl = document.location.href;

    // Parse article using Readability
    const reader = new Readability(documentClone, {
      charThreshold: 0
    });
    const article = reader.parse();

    if (!article || !article.content) {
      return {
        success: false,
        error: 'Could not extract article content. This page may not have readable content.'
      };
    }

    // Create a temporary container to process Readability's content
    const container = document.createElement('div');
    container.innerHTML = article.content;

    // ============================================
    // Image Extraction (combining multiple sources)
    // ============================================

    // Use a Set to avoid duplicates (by element reference)
    const imageSet = new Set();

    // Source 1: Get images from Readability's parsed content
    const readabilityImages = container.querySelectorAll('img');
    readabilityImages.forEach(img => imageSet.add(img));

    // Source 2: Search original document for content images
    // (always do this - Readability often strips images)
    const documentImages = findImagesInDocument(document);
    documentImages.forEach(img => imageSet.add(img));

    // Source 3: If still few images, do broader search on original page
    if (imageSet.size < 3) {
      const allPageImages = document.querySelectorAll('img');
      allPageImages.forEach(img => imageSet.add(img));
    }

    const images = Array.from(imageSet);

    const imageMap = new Map(); // url -> { filename, blob }
    const failedImages = [];
    const skippedImages = [];
    let imageIndex = 0;

    for (const img of images) {
      // Use enhanced URL extraction (handles lazy loading)
      const src = getImageUrl(img);
      if (!src) continue;

      const resolvedUrl = resolveImageUrl(src, baseUrl);
      if (!resolvedUrl) continue;

      // Skip if already processed
      if (imageMap.has(resolvedUrl)) continue;

      // Filter out non-content images (avatars, icons, etc.)
      if (!isContentImage(img, resolvedUrl)) {
        skippedImages.push(resolvedUrl);
        continue;
      }

      try {
        let blob, contentType;

        // Handle data URLs using shared library
        if (resolvedUrl.startsWith('data:')) {
          const result = dataURLtoBlob(resolvedUrl);
          if (!result) {
            failedImages.push(resolvedUrl);
            continue;
          }
          blob = result.blob;
          contentType = result.contentType;
        } else {
          // Use shared ImageFetcher (handles CORS via background script)
          const result = await fetchImageAsBlob(resolvedUrl);
          blob = result.blob;
          contentType = result.contentType;
        }

        // Skip very small images (likely tracking pixels)
        if (!blob || blob.size < 100) {
          skippedImages.push(resolvedUrl);
          continue;
        }

        const ext = getImageExtension(resolvedUrl, contentType);
        imageIndex++;
        const filename = `image-${imageIndex}.${ext}`;

        imageMap.set(resolvedUrl, { filename, blob });
      } catch (error) {
        failedImages.push(resolvedUrl);
        console.warn(`Failed to download image: ${resolvedUrl}`, error.message);
      }
    }

    // Check if we found any images
    if (imageMap.size === 0) {
      // Provide detailed diagnostic info
      const totalPageImages = document.querySelectorAll('img').length;
      let errorMsg;

      if (failedImages.length > 0) {
        errorMsg = `Could not download any images. ${failedImages.length} image(s) failed (server errors or invalid URLs). Found ${totalPageImages} images on page.`;
      } else if (skippedImages.length > 0) {
        errorMsg = `No content images found. ${skippedImages.length} image(s) were skipped (icons/avatars/small). Found ${totalPageImages} images on page.`;
      } else if (images.length === 0) {
        errorMsg = `No images detected. Total images on page: ${totalPageImages}. The page may use non-standard image loading.`;
      } else {
        errorMsg = `No downloadable images found. Detected ${images.length} images, but none had valid URLs. Total on page: ${totalPageImages}.`;
      }
      return {
        success: false,
        error: errorMsg
      };
    }

    // ============================================
    // Create ZIP Archive
    // ============================================

    const zip = new JSZip();
    const title = article.title || document.title || 'Untitled';
    const safeTitle = sanitizeFilename(title);

    // Add all images to zip
    for (const [url, { filename, blob }] of imageMap) {
      zip.file(filename, blob);
    }

    // Generate ZIP
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Convert blob to base64 for transfer
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(zipBlob);
    });

    return {
      success: true,
      zipData: base64Data,
      filename: `${safeTitle}-images.zip`,
      stats: {
        title: title,
        imagesDownloaded: imageMap.size,
        imagesFailed: failedImages.length,
        sizeKB: Math.round(zipBlob.size / 1024)
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'An unexpected error occurred during image extraction'
    };
  }
})();
