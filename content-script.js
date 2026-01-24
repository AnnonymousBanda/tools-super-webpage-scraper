// Content script for extracting article content and creating markdown ZIP
// This runs in the page context after libraries are injected

(async function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const IMAGE_TIMEOUT = 5000; // 5 seconds per image
  const MAX_FILENAME_LENGTH = 100;

  // ============================================
  // Utility Functions
  // ============================================

  function sanitizeFilename(name) {
    if (!name || name.trim() === '') {
      return 'untitled-' + Date.now();
    }
    // Remove invalid filename characters
    let sanitized = name.replace(/[/\\:*?"<>|#%&{}$!'@+`=]/g, '');
    // Replace multiple spaces/underscores with single
    sanitized = sanitized.replace(/[\s_]+/g, '-');
    // Remove leading/trailing dashes and spaces
    sanitized = sanitized.replace(/^[-\s]+|[-\s]+$/g, '');
    // Truncate
    if (sanitized.length > MAX_FILENAME_LENGTH) {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH).replace(/-+$/, '');
    }
    return sanitized || 'untitled-' + Date.now();
  }

  function getFileExtension(url, contentType) {
    // Try to get extension from content type first
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
      'image/avif': 'avif'
    };

    if (contentType && mimeToExt[contentType.split(';')[0]]) {
      return mimeToExt[contentType.split(';')[0]];
    }

    // Try to extract from URL
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        const ext = match[1].toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'avif'].includes(ext)) {
          return ext === 'jpeg' ? 'jpg' : ext;
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }

    return 'jpg'; // Default fallback
  }

  function resolveUrl(src, baseUrl) {
    if (!src) return null;
    if (src.startsWith('data:')) return src; // Keep data URLs as-is
    try {
      return new URL(src, baseUrl).href;
    } catch (e) {
      return null;
    }
  }

  async function fetchImageAsBlob(url) {
    // Try multiple fetch strategies for different CORS configurations
    const strategies = [
      { mode: 'cors', credentials: 'omit' },
      { mode: 'cors', credentials: 'include' },
      { mode: 'cors', credentials: 'same-origin' }
    ];

    let lastError;

    for (const strategy of strategies) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IMAGE_TIMEOUT);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          ...strategy
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const contentType = response.headers.get('content-type') || '';

        if (blob.size > 0) {
          return { blob, contentType };
        }
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
      }
    }

    throw lastError || new Error('All fetch strategies failed');
  }

  // Extract best image URL from an img element
  function getImageUrl(img) {
    // First check direct properties
    if (img.src && img.src.length > 10 && !img.src.startsWith('data:image/svg')) {
      if (!(img.src.startsWith('data:') && img.src.length < 200)) {
        return img.src;
      }
    }

    if (img.currentSrc && img.currentSrc.length > 10) {
      return img.currentSrc;
    }

    // Check attributes for lazy loading
    const srcAttributes = [
      'src', 'data-src', 'data-lazy-src', 'data-original',
      'data-src-medium', 'data-src-large', 'data-hi-res-src'
    ];

    for (const attr of srcAttributes) {
      const value = img.getAttribute(attr);
      if (value && value.length > 10 && !value.startsWith('data:image/svg')) {
        if (value.startsWith('data:') && value.length < 200) continue;
        return value;
      }
    }

    // Check srcset
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (srcset) {
      const sources = srcset.split(',').map(s => s.trim());
      const lastSource = sources[sources.length - 1];
      const url = lastSource.split(/\s+/)[0];
      if (url && url.length > 10) return url;
    }

    return null;
  }

  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  // ============================================
  // Main Extraction Logic
  // ============================================

  try {
    // Check if Readability is loaded
    if (typeof Readability === 'undefined') {
      throw new Error('Readability library not loaded');
    }
    if (typeof TurndownService === 'undefined') {
      throw new Error('Turndown library not loaded');
    }
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded');
    }

    // Scroll through page to trigger lazy-loaded images (uses shared library)
    if (typeof triggerLazyLoading === 'function') {
      await triggerLazyLoading();
    }

    // Clone the document to avoid modifying the page (after lazy images loaded)
    const documentClone = document.cloneNode(true);
    const baseUrl = document.location.href;

    // Parse article using Readability
    const reader = new Readability(documentClone, {
      charThreshold: 0 // Allow shorter content
    });
    const article = reader.parse();

    if (!article || !article.content) {
      return {
        success: false,
        error: 'Could not extract article content. This page may not have readable content.'
      };
    }

    // Create a temporary container to process the content
    const container = document.createElement('div');
    container.innerHTML = article.content;

    // ============================================
    // Image Processing
    // ============================================

    const images = container.querySelectorAll('img');
    const imageMap = new Map(); // url -> { filename, blob }
    const failedImages = [];
    let imageIndex = 0;

    for (const img of images) {
      // Get the image source using enhanced extraction (handles lazy loading)
      const src = getImageUrl(img);
      if (!src) continue;

      const resolvedUrl = resolveUrl(src, baseUrl);
      if (!resolvedUrl) continue;

      // Skip data URLs - they'll stay inline
      if (resolvedUrl.startsWith('data:')) {
        continue;
      }

      // Skip if already processed
      if (imageMap.has(resolvedUrl)) {
        // Update img src to local path
        img.setAttribute('src', `./images/${imageMap.get(resolvedUrl).filename}`);
        continue;
      }

      try {
        const { blob, contentType } = await fetchImageAsBlob(resolvedUrl);

        // Skip very small images (likely tracking pixels)
        if (blob.size < 100) {
          continue;
        }

        const ext = getFileExtension(resolvedUrl, contentType);
        imageIndex++;
        const filename = `img${imageIndex}.${ext}`;

        imageMap.set(resolvedUrl, { filename, blob });
        img.setAttribute('src', `./images/${filename}`);
      } catch (error) {
        // Image failed to download - keep original URL
        failedImages.push(resolvedUrl);
        console.warn(`Failed to download image: ${resolvedUrl}`, error.message);
      }
    }

    // ============================================
    // Convert to Markdown
    // ============================================

    // Configure Turndown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*'
    });

    // Add GFM plugin if available
    if (typeof turndownPluginGfm !== 'undefined') {
      turndownService.use(turndownPluginGfm.gfm);
    }

    // Custom rule for images to use local paths
    turndownService.addRule('images', {
      filter: 'img',
      replacement: function(content, node) {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        const title = node.getAttribute('title');

        if (!src) return '';

        const titlePart = title ? ` "${title}"` : '';
        return `![${alt}](${src}${titlePart})`;
      }
    });

    // Convert HTML to Markdown
    const markdownContent = turndownService.turndown(container.innerHTML);

    // ============================================
    // Build Frontmatter
    // ============================================

    const title = article.title || document.title || 'Untitled';
    const author = article.byline || '';
    const publishedTime = article.publishedTime || '';
    const siteName = article.siteName || '';

    let frontmatter = '---\n';
    frontmatter += `title: "${title.replace(/"/g, '\\"')}"\n`;
    frontmatter += `source: ${baseUrl}\n`;
    frontmatter += `date: ${formatDate(new Date())}\n`;
    if (author) {
      frontmatter += `author: "${author.replace(/"/g, '\\"')}"\n`;
    }
    if (siteName) {
      frontmatter += `site: "${siteName.replace(/"/g, '\\"')}"\n`;
    }
    if (publishedTime) {
      frontmatter += `published: ${publishedTime}\n`;
    }
    frontmatter += '---\n\n';

    // Build final markdown
    const finalMarkdown = frontmatter + `# ${title}\n\n` + markdownContent;

    // ============================================
    // Create ZIP Archive
    // ============================================

    const zip = new JSZip();
    const safeTitle = sanitizeFilename(title);

    // Add markdown file
    zip.file(`${safeTitle}.md`, finalMarkdown);

    // Add images folder if we have images
    if (imageMap.size > 0) {
      const imagesFolder = zip.folder('images');
      for (const [url, { filename, blob }] of imageMap) {
        imagesFolder.file(filename, blob);
      }
    }

    // Generate ZIP
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Convert blob to base64 for transfer
    const reader2 = new FileReader();
    const base64Promise = new Promise((resolve, reject) => {
      reader2.onload = () => resolve(reader2.result);
      reader2.onerror = reject;
    });
    reader2.readAsDataURL(zipBlob);
    const base64Data = await base64Promise;

    return {
      success: true,
      zipData: base64Data,
      filename: `${safeTitle}.zip`,
      stats: {
        title: title,
        imagesDownloaded: imageMap.size,
        imagesFailed: failedImages.length,
        markdownLength: finalMarkdown.length
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'An unexpected error occurred during extraction'
    };
  }
})();
