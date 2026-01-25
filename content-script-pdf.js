// Content script for generating PDF with selectable text
// Uses jsPDF native text rendering with emoji support via canvas

(async function() {
  'use strict';

  // ============================================
  // Configuration - Standard PDF formatting
  // ============================================

  const PDF_CONFIG = {
    // A4 dimensions in mm
    page: {
      width: 210,
      height: 297,
      marginTop: 20,
      marginBottom: 15,
      marginLeft: 20,
      marginRight: 20
    },

    // Standard typography (in points)
    fonts: {
      body: { size: 11, lineHeight: 1.5 },
      h1: { size: 22, lineHeight: 1.3 },
      h2: { size: 18, lineHeight: 1.3 },
      h3: { size: 14, lineHeight: 1.3 },
      h4: { size: 12, lineHeight: 1.3 },
      h5: { size: 11, lineHeight: 1.3 },
      h6: { size: 10, lineHeight: 1.3 },
      code: { size: 9, lineHeight: 1.4 },
      meta: { size: 9, lineHeight: 1.4 },
      footer: { size: 8, lineHeight: 1.2 }
    },

    // Spacing (in mm)
    spacing: {
      paragraph: 4,
      heading: 6,
      list: 2,
      codeBlock: 4,
      blockquote: 4,
      image: 5
    },

    // Colors (RGB 0-255)
    colors: {
      text: [33, 33, 33],
      heading: [0, 0, 0],
      link: [0, 102, 204],
      meta: [102, 102, 102],
      code: [51, 51, 51],
      codeBackground: [245, 245, 245],
      blockquoteBorder: [200, 200, 200],
      blockquoteText: [85, 85, 85],
      tableBorder: [200, 200, 200],
      tableHeader: [240, 240, 240],
      tableAltRow: [250, 250, 250]
    },

    // Image settings
    image: {
      maxWidthPercent: 0.95,  // Max width as percentage of content width
      maxHeightMm: 180,       // Max height in mm
      minWidthMm: 40,         // Minimum width for readability
      minHeightMm: 25,        // Minimum height for readability
      quality: 0.92           // JPEG quality for conversion
    }
  };

  const MAX_FILENAME_LENGTH = 100;
  const IMAGE_TIMEOUT = 15000; // 15 seconds for image loading

  // ============================================
  // Utility Functions
  // ============================================

  function sanitizeFilename(name) {
    if (!name || name.trim() === '') return 'untitled-' + Date.now();
    let sanitized = name.replace(/[/\\:*?"<>|#%&{}$!'@+`=]/g, '');
    sanitized = sanitized.replace(/[\s_]+/g, '-');
    sanitized = sanitized.replace(/^[-\s]+|[-\s]+$/g, '');
    if (sanitized.length > MAX_FILENAME_LENGTH) {
      sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH).replace(/-+$/, '');
    }
    return sanitized || 'untitled-' + Date.now();
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // ============================================
  // Emoji Detection and Rendering
  // ============================================

  /**
   * Creates a fresh emoji regex to avoid lastIndex state issues with global flag
   * Comprehensive pattern covering:
   * - Emoticons, dingbats, symbols
   * - Skin tone modifiers, ZWJ sequences
   * - Flags, transport, food, activities, objects
   * - Miscellaneous symbols and pictographs
   */
  function createEmojiRegex() {
    return new RegExp(
      '(?:' +
      // Main emoji blocks
      '[\u{1F300}-\u{1F5FF}]|' +  // Misc Symbols and Pictographs
      '[\u{1F600}-\u{1F64F}]|' +  // Emoticons
      '[\u{1F680}-\u{1F6FF}]|' +  // Transport and Map
      '[\u{1F700}-\u{1F77F}]|' +  // Alchemical Symbols
      '[\u{1F780}-\u{1F7FF}]|' +  // Geometric Shapes Extended
      '[\u{1F800}-\u{1F8FF}]|' +  // Supplemental Arrows-C
      '[\u{1F900}-\u{1F9FF}]|' +  // Supplemental Symbols and Pictographs
      '[\u{1FA00}-\u{1FA6F}]|' +  // Chess Symbols
      '[\u{1FA70}-\u{1FAFF}]|' +  // Symbols and Pictographs Extended-A
      '[\u{2600}-\u{26FF}]|' +    // Misc symbols (sun, moon, stars, etc.)
      '[\u{2700}-\u{27BF}]|' +    // Dingbats (pointing hands, scissors, etc.)
      '[\u{2300}-\u{23FF}]|' +    // Misc Technical
      '[\u{2B50}-\u{2B55}]|' +    // Additional symbols
      '[\u{231A}-\u{231B}]|' +    // Watch, Hourglass
      '[\u{23E9}-\u{23F3}]|' +    // Media control symbols
      '[\u{23F8}-\u{23FA}]|' +    // Media control symbols
      '[\u{25AA}-\u{25AB}]|' +    // Squares
      '[\u{25B6}]|[\u{25C0}]|' +  // Play buttons
      '[\u{25FB}-\u{25FE}]|' +    // Squares
      '[\u{2614}-\u{2615}]|' +    // Umbrella, Hot Beverage
      '[\u{2648}-\u{2653}]|' +    // Zodiac
      '[\u{267F}]|' +             // Wheelchair
      '[\u{2693}]|' +             // Anchor
      '[\u{26A1}]|' +             // High Voltage
      '[\u{26AA}-\u{26AB}]|' +    // Circles
      '[\u{26BD}-\u{26BE}]|' +    // Sports balls
      '[\u{26C4}-\u{26C5}]|' +    // Snowman, Sun
      '[\u{26CE}]|' +             // Ophiuchus
      '[\u{26D4}]|' +             // No Entry
      '[\u{26EA}]|' +             // Church
      '[\u{26F2}-\u{26F3}]|' +    // Fountain, Golf
      '[\u{26F5}]|' +             // Sailboat
      '[\u{26FA}]|' +             // Tent
      '[\u{26FD}]|' +             // Fuel Pump
      '[\u{2702}]|' +             // Scissors
      '[\u{2705}]|' +             // Check Mark
      '[\u{2708}-\u{270D}]|' +    // Airplane to Writing Hand
      '[\u{270F}]|' +             // Pencil
      '[\u{2712}]|' +             // Black Nib
      '[\u{2714}]|' +             // Check Mark
      '[\u{2716}]|' +             // X Mark
      '[\u{271D}]|' +             // Latin Cross
      '[\u{2721}]|' +             // Star of David
      '[\u{2728}]|' +             // Sparkles
      '[\u{2733}-\u{2734}]|' +    // Eight Spoked Asterisk
      '[\u{2744}]|' +             // Snowflake
      '[\u{2747}]|' +             // Sparkle
      '[\u{274C}]|' +             // Cross Mark
      '[\u{274E}]|' +             // Cross Mark
      '[\u{2753}-\u{2755}]|' +    // Question Marks
      '[\u{2757}]|' +             // Exclamation Mark
      '[\u{2763}-\u{2764}]|' +    // Heart Exclamation, Heart
      '[\u{2795}-\u{2797}]|' +    // Math symbols
      '[\u{27A1}]|' +             // Right Arrow (👉 uses this area)
      '[\u{27B0}]|' +             // Curly Loop
      '[\u{27BF}]|' +             // Double Curly Loop
      '[\u{2934}-\u{2935}]|' +    // Arrows
      '[\u{2B05}-\u{2B07}]|' +    // Arrows
      '[\u{2B1B}-\u{2B1C}]|' +    // Squares
      '[\u{3030}]|' +             // Wavy Dash
      '[\u{303D}]|' +             // Part Alternation Mark
      '[\u{3297}]|' +             // Circled Ideograph Congratulation
      '[\u{3299}]|' +             // Circled Ideograph Secret
      '[\u{00A9}]|' +             // Copyright
      '[\u{00AE}]|' +             // Registered
      '[\u{203C}]|' +             // Double Exclamation
      '[\u{2049}]|' +             // Exclamation Question
      // Variation selectors and ZWJ (for sequences)
      '[\u{FE0F}]|' +             // Variation Selector-16
      '[\u{200D}]|' +             // Zero Width Joiner
      // Skin tone modifiers
      '[\u{1F3FB}-\u{1F3FF}]|' +  // Skin tones
      // Regional indicator symbols (flags)
      '[\u{1F1E0}-\u{1F1FF}]' +
      ')+',
      'gu'
    );
  }

  /**
   * Test if text contains emoji - creates fresh regex each time to avoid state issues
   */
  function hasEmoji(text) {
    if (!text) return false;
    const regex = createEmojiRegex();
    return regex.test(text);
  }

  /**
   * Find all emojis in text - creates fresh regex each time
   */
  function findEmojis(text) {
    if (!text) return [];
    const regex = createEmojiRegex();
    return text.match(regex) || [];
  }

  /**
   * Split text into parts (text and emojis)
   */
  function splitTextAndEmojis(text) {
    if (!text) return [];
    const regex = createEmojiRegex();
    const parts = [];
    let lastIndex = 0;
    let match;

    // Reset and iterate
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      // Add text before emoji
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      // Add emoji
      parts.push({ type: 'emoji', content: match[0] });
      lastIndex = regex.lastIndex;
    }
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }
    return parts;
  }

  /**
   * Render emoji to canvas and return as data URL
   * Uses multiple font fallbacks for cross-platform support
   */
  function renderEmojiToImage(emoji, fontSize) {
    try {
      const canvas = document.createElement('canvas');
      const size = Math.ceil(fontSize * 3); // 3x for better quality
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Use system emoji fonts with fallbacks
      ctx.font = `${size * 0.7}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "EmojiOne Color", "Twemoji Mozilla", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, size / 2, size / 2);

      // Check if emoji was actually rendered (canvas not empty)
      const imageData = ctx.getImageData(0, 0, size, size);
      const hasContent = imageData.data.some((value, index) => index % 4 === 3 && value > 0);

      if (!hasContent) {
        return null; // Emoji rendering failed
      }

      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('Emoji rendering failed:', emoji, e);
      return null;
    }
  }

  /**
   * Get text replacement for emoji when image rendering fails
   */
  function getEmojiFallbackText(emoji) {
    // Common emoji to text mappings
    const fallbacks = {
      '👉': '->',
      '👈': '<-',
      '👆': '^',
      '👇': 'v',
      '✅': '[x]',
      '❌': '[X]',
      '⭐': '*',
      '🔥': '[fire]',
      '💡': '[idea]',
      '⚠️': '[!]',
      '📌': '[pin]',
      '📍': '[loc]',
      '🎯': '[target]',
      '✨': '*',
      '💪': '[strong]',
      '🚀': '[rocket]',
      '📈': '[up]',
      '📉': '[down]',
      '➡️': '->',
      '⬅️': '<-',
      '⬆️': '^',
      '⬇️': 'v',
      '↗️': '/^',
      '↘️': '\\v',
      '↙️': '/v',
      '↖️': '\\^',
      '🔗': '[link]',
      '📧': '[email]',
      '📞': '[phone]',
      '💬': '[chat]',
      '📝': '[note]',
      '📋': '[list]',
      '🎉': '[party]',
      '👍': '[+1]',
      '👎': '[-1]',
      '❤️': '<3',
      '💙': '<3',
      '💚': '<3',
      '💛': '<3',
      '🧡': '<3',
      '💜': '<3',
      '🖤': '<3',
      '🤍': '<3',
      '♥️': '<3',
      '©️': '(c)',
      '®️': '(R)',
      '™️': '(TM)',
    };
    return fallbacks[emoji] || '';
  }

  // ============================================
  // Text Sanitization for PDF
  // ============================================

  /**
   * Sanitize text for PDF rendering
   * Handles special characters and optionally preserves emojis for image rendering
   */
  function sanitizeTextForPDF(text, preserveEmojis = false) {
    if (!text) return '';

    // Unicode to ASCII replacements (non-emoji)
    const replacements = {
      // Arrows (comprehensive)
      '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
      '\u21d2': '=>', '\u21d0': '<=', '\u2191': '^', '\u2193': 'v',
      '\u21e8': '->', '\u21e6': '<-', '\u21e7': '^', '\u21e9': 'v',
      '\u279c': '->', '\u279e': '->', '\u27a1': '->',
      '\u2b95': '->', '\u2b05': '<-', '\u2b06': '^', '\u2b07': 'v',
      '\u2934': '/^', '\u2935': '\\v',
      // Quotes
      '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
      '\u201A': ',', '\u201E': '"', '\u2039': '<', '\u203A': '>',
      '\u00AB': '<<', '\u00BB': '>>', '\u201B': "'", '\u201F': '"',
      // Dashes and hyphens
      '\u2013': '-', '\u2014': '--', '\u2012': '-', '\u2015': '--',
      '\u2010': '-', '\u2011': '-', '\u2212': '-',
      // Spaces (various Unicode spaces)
      '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ',
      '\u200A': ' ', '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '',
      '\u2004': ' ', '\u2005': ' ', '\u2006': ' ', '\u2007': ' ', '\u2008': ' ',
      '\u202F': ' ', '\u205F': ' ', '\u3000': ' ',
      // Bullets and list markers
      '\u2022': '*', '\u2023': '>', '\u2043': '-', '\u204C': '<',
      '\u204D': '>', '\u2219': '.', '\u25AA': '*', '\u25AB': '*',
      '\u25CF': '*', '\u25CB': 'o', '\u25A0': '*', '\u25A1': 'o',
      '\u25B6': '>', '\u25C0': '<', '\u25B8': '>', '\u25C2': '<',
      '\u2713': '[x]', '\u2714': '[x]', '\u2717': '[ ]', '\u2718': '[ ]',
      '\u2605': '*', '\u2606': '*', '\u2729': '*', '\u272A': '*',
      '\u2756': '*', '\u2727': '*',
      // Math symbols
      '\u00D7': 'x', '\u00F7': '/', '\u00B1': '+/-',
      '\u2260': '!=', '\u2264': '<=', '\u2265': '>=', '\u221E': 'infinity',
      '\u2248': '~=', '\u2261': '===', '\u2245': '~=', '\u2243': '~',
      '\u221A': 'sqrt', '\u2211': 'sum', '\u220F': 'prod',
      '\u2208': 'in', '\u2209': 'not in', '\u2282': 'subset',
      '\u222A': 'union', '\u2229': 'intersect',
      // Ellipsis and dots
      '\u2026': '...', '\u00B7': '.', '\u2027': '.', '\u22C5': '.',
      '\u2024': '.', '\u2025': '..', '\u22EF': '...',
      // Legal/trademark
      '\u00A9': '(c)', '\u00AE': '(R)', '\u2122': '(TM)',
      '\u2117': '(P)', '\u2120': '(SM)',
      // Degrees and primes
      '\u00B0': ' deg', '\u2032': "'", '\u2033': '"', '\u2034': "'''",
      '\u2103': ' C', '\u2109': ' F',
      // Fractions
      '\u00BC': '1/4', '\u00BD': '1/2', '\u00BE': '3/4',
      '\u2153': '1/3', '\u2154': '2/3', '\u2155': '1/5',
      '\u2156': '2/5', '\u2157': '3/5', '\u2158': '4/5',
      '\u2159': '1/6', '\u215A': '5/6', '\u215B': '1/8',
      // Currency
      '\u20AC': 'EUR', '\u00A3': 'GBP', '\u00A5': 'JPY', '\u20B9': 'INR',
      '\u20A8': 'Rs', '\u20B1': 'PHP', '\u20B4': 'UAH', '\u20BD': 'RUB',
      '\u00A2': 'c', '\u20A9': 'KRW', '\u20BA': 'TRY',
      // Superscripts/subscripts
      '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
      '\u2070': '0', '\u2074': '4', '\u2075': '5', '\u2076': '6',
      '\u2077': '7', '\u2078': '8', '\u2079': '9',
      // Misc symbols
      '\u203C': '!!', '\u2049': '!?', '\u2047': '??', '\u2048': '?!',
      '\u00A6': '|', '\u00A7': 'S', '\u00B6': 'P', '\u00AC': 'not',
      '\u2020': '+', '\u2021': '++', '\u2030': '0/00', '\u2031': '0/000',
      // Ligatures
      '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl',
      '\u0152': 'OE', '\u0153': 'oe', '\u00C6': 'AE', '\u00E6': 'ae',
    };

    let result = text;

    // Apply character replacements
    for (const [unicode, ascii] of Object.entries(replacements)) {
      result = result.split(unicode).join(ascii);
    }

    if (!preserveEmojis) {
      // Remove emojis entirely if not preserving - use fresh regex
      const emojiRegex = createEmojiRegex();
      result = result.replace(emojiRegex, '');
    }

    // Remove remaining unsupported characters but keep emojis if preserving
    if (preserveEmojis) {
      // Keep ASCII, extended Latin, and common emoji ranges
      result = result.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu, '');
    } else {
      // Keep only ASCII and extended Latin
      result = result.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '');
    }

    // Normalize multiple spaces to single space
    result = result.replace(/  +/g, ' ');
    // Normalize line endings
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Remove lines that are only spaces
    result = result.replace(/\n +\n/g, '\n\n');

    return result.trim();
  }

  // ============================================
  // Image Handling - Using Shared ImageFetcher
  // ============================================

  /**
   * CRITICAL: This function fetches images AND converts to PNG in one step.
   *
   * Why this approach:
   * 1. fetchImageAsBlob WORKS (proven by Save All Images feature)
   * 2. CDNs like Framer return WebP/AVIF which jsPDF can't handle
   * 3. We convert unsupported formats to JPEG (smaller than PNG for photos)
   *
   * Strategy:
   * - JPEG/PNG: Pass through directly (jsPDF handles these well)
   * - WebP/AVIF/other: Convert to JPEG via canvas with quality setting
   */
  async function fetchImageForPdf(url, timeout = IMAGE_TIMEOUT) {
    if (!url) return null;
    if (url.startsWith('data:')) {
      return convertDataUrlForPdf(url, timeout);
    }

    try {
      // Fetch blob using ImageFetcher (handles CORS via background script)
      let blob, contentType;
      if (window.ImageFetcher && window.ImageFetcher.fetchImageAsBlob) {
        const result = await window.ImageFetcher.fetchImageAsBlob(url);
        blob = result.blob;
        contentType = result.contentType || blob.type;
      } else {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) return null;
        blob = await response.blob();
        contentType = response.headers.get('content-type') || blob.type;
      }

      if (!blob || blob.size === 0) return null;

      // Check if format is already supported by jsPDF
      const format = (contentType || '').split(';')[0].trim().toLowerCase();
      if (format === 'image/jpeg' || format === 'image/png') {
        // Pass through directly - no conversion needed
        return await blobToDataUrl(blob);
      }

      // Convert unsupported formats (WebP, AVIF, etc.) to JPEG
      return await convertBlobToJpeg(blob, timeout);
    } catch (e) {
      return null;
    }
  }

  /**
   * Convert blob to data URL without canvas (preserves original format)
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Convert a blob to JPEG data URL via canvas
   * Uses quality 0.85 for good balance of size and quality
   */
  async function convertBlobToJpeg(blob, timeout = IMAGE_TIMEOUT, quality = 0.85) {
    return new Promise((resolve) => {
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();

      const timeoutHandle = setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        resolve(null);
      }, timeout);

      img.onload = () => {
        clearTimeout(timeoutHandle);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          // Fill with white background (JPEG doesn't support transparency)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(blobUrl);
          resolve(jpegDataUrl);
        } catch (e) {
          URL.revokeObjectURL(blobUrl);
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timeoutHandle);
        URL.revokeObjectURL(blobUrl);
        resolve(null);
      };

      img.src = blobUrl;
    });
  }

  /**
   * Convert a data URL for PDF if needed
   * JPEG/PNG pass through, others convert to JPEG
   */
  async function convertDataUrlForPdf(dataUrl, timeout = IMAGE_TIMEOUT) {
    if (!dataUrl) return null;

    // Check if already JPEG or PNG (formats jsPDF handles reliably)
    const mimeMatch = dataUrl.match(/^data:image\/([^;,]+)/i);
    if (mimeMatch) {
      const format = mimeMatch[1].toLowerCase();
      if (format === 'png' || format === 'jpeg' || format === 'jpg') {
        return dataUrl; // Already compatible
      }
    }

    // Convert unsupported formats to JPEG via canvas
    return new Promise((resolve) => {
      const img = new Image();
      const timeoutHandle = setTimeout(() => {
        console.warn('convertDataUrlForPdf: timeout');
        resolve(null);
      }, timeout);

      img.onload = () => {
        clearTimeout(timeoutHandle);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          // Fill with white background for JPEG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          console.warn('convertDataUrlForPdf: canvas error', e.message);
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timeoutHandle);
        console.warn('convertDataUrlForPdf: image load error');
        resolve(null);
      };

      img.src = dataUrl;
    });
  }

  /**
   * Check if a URL is a valid image URL (not a placeholder or tracking pixel)
   */
  function isValidImageUrl(url) {
    if (!url || url.length < 5) return false;

    // Skip inline SVG placeholders
    if (url.startsWith('data:image/svg+xml')) return false;

    // Skip tiny data URLs (likely placeholders - base64 1x1 pixels are ~50-100 chars)
    if (url.startsWith('data:') && url.length < 200) return false;

    // Skip common placeholder patterns
    const placeholderPatterns = [
      'placeholder', 'blank.gif', 'spacer.gif', 'pixel.gif',
      'transparent.png', 'empty.png', '1x1', 'loading'
    ];
    const lowerUrl = url.toLowerCase();
    if (placeholderPatterns.some(p => lowerUrl.includes(p))) return false;

    return true;
  }

  /**
   * Detect image format from data URL (used for error logging)
   */
  function detectImageFormat(dataUrl) {
    if (!dataUrl) return 'unknown';
    const mimeMatch = dataUrl.match(/^data:image\/([^;,]+)/i);
    if (mimeMatch) {
      const mime = mimeMatch[1].toLowerCase();
      return mime === 'jpg' ? 'jpeg' : mime;
    }
    return 'unknown';
  }

  /**
   * Parse srcset attribute and return the best (highest resolution) URL
   */
  function getBestSrcFromSrcset(srcset) {
    if (!srcset) return null;

    const sources = srcset.split(',').map(s => {
      const parts = s.trim().split(/\s+/);
      const url = parts[0];
      let width = 0;
      let density = 1;

      if (parts[1]) {
        if (parts[1].endsWith('w')) {
          width = parseInt(parts[1]) || 0;
        } else if (parts[1].endsWith('x')) {
          density = parseFloat(parts[1]) || 1;
        }
      }

      return { url, width, density };
    }).filter(s => s.url && isValidImageUrl(s.url));

    if (sources.length === 0) return null;

    // Sort by width (descending), then by density (descending)
    sources.sort((a, b) => {
      if (b.width !== a.width) return b.width - a.width;
      return b.density - a.density;
    });

    return sources[0].url;
  }

  /**
   * Get the best image URL from an img element
   * Handles various lazy loading patterns and responsive image attributes
   */
  function getImageUrl(img) {
    if (!img) return null;

    // Comprehensive list of lazy loading attributes used by various frameworks
    const lazyLoadAttrs = [
      // Standard
      'src', 'data-src',
      // Common lazy loading libraries
      'data-lazy-src', 'data-lazy', 'data-original', 'data-url',
      // WordPress/plugins
      'data-src-medium', 'data-src-large', 'data-hi-res-src', 'data-full-src',
      // Next.js / Gatsby / React
      'data-main', 'data-normal', 'data-zoom', 'data-image',
      // Other common patterns
      'data-actualsrc', 'data-real-src', 'data-defer-src', 'data-load-src',
      'data-bg', 'data-background', 'data-poster',
      // Akamai/CDN lazy loading
      'data-srcset-lazy', 'data-sizes-lazy',
      // Medium
      'data-src-preview', 'data-image-id'
    ];

    // 1. First try currentSrc (already resolved by browser for responsive images)
    if (img.currentSrc && isValidImageUrl(img.currentSrc)) {
      return img.currentSrc;
    }

    // 2. Check srcset for highest resolution image
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') ||
                   img.getAttribute('data-lazy-srcset') || img.getAttribute('data-srcset-lazy');
    const srcsetUrl = getBestSrcFromSrcset(srcset);
    if (srcsetUrl) {
      return srcsetUrl;
    }

    // 3. Try standard src
    if (img.src && isValidImageUrl(img.src)) {
      return img.src;
    }

    // 4. Try all lazy loading attributes
    for (const attr of lazyLoadAttrs) {
      const val = img.getAttribute(attr);
      if (val && isValidImageUrl(val)) {
        return val;
      }
    }

    // 5. Check for background image in style
    const style = img.getAttribute('style');
    if (style) {
      const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
      if (bgMatch && isValidImageUrl(bgMatch[1])) {
        return bgMatch[1];
      }
    }

    return null;
  }

  /**
   * Get image URL from a picture element (handles source elements)
   */
  function getImageUrlFromPicture(picture) {
    if (!picture) return null;

    // First check source elements for best resolution
    const sources = picture.querySelectorAll('source');
    for (const source of sources) {
      const srcset = source.getAttribute('srcset');
      const srcsetUrl = getBestSrcFromSrcset(srcset);
      if (srcsetUrl) {
        return srcsetUrl;
      }
    }

    // Fallback to img inside picture
    const img = picture.querySelector('img');
    if (img) {
      return getImageUrl(img);
    }

    return null;
  }

  /**
   * Get rendered dimensions of an image element
   * Returns { width, height } in pixels, or null if not available
   */
  function getRenderedDimensions(img) {
    if (!img) return null;

    // Try to get explicitly set dimensions first (from attributes or style)
    let width = null;
    let height = null;

    // Check HTML attributes
    const attrWidth = img.getAttribute('width');
    const attrHeight = img.getAttribute('height');
    if (attrWidth && !attrWidth.includes('%')) {
      width = parseInt(attrWidth, 10);
    }
    if (attrHeight && !attrHeight.includes('%')) {
      height = parseInt(attrHeight, 10);
    }

    // Check inline style
    const style = img.style;
    if (style.width && !style.width.includes('%')) {
      const parsedWidth = parseInt(style.width, 10);
      if (!isNaN(parsedWidth)) width = parsedWidth;
    }
    if (style.height && !style.height.includes('%')) {
      const parsedHeight = parseInt(style.height, 10);
      if (!isNaN(parsedHeight)) height = parsedHeight;
    }

    // Try computed style / bounding rect for actually rendered size
    try {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Use rendered size if it seems reasonable (not tiny placeholders)
        if (rect.width >= 20 && rect.height >= 20) {
          width = width || Math.round(rect.width);
          height = height || Math.round(rect.height);
        }
      }
    } catch (e) {
      // getBoundingClientRect may fail in some contexts
    }

    // Also check naturalWidth/naturalHeight as fallback for intrinsic size
    if (img.naturalWidth && img.naturalHeight) {
      if (!width) width = img.naturalWidth;
      if (!height) height = img.naturalHeight;
    }

    if (width && height && width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  }

  /**
   * Find all images within a node (including nested images, picture elements, etc.)
   * Returns array of { src, alt, renderedWidth, renderedHeight } objects
   */
  function findAllImages(node) {
    const images = [];
    const seen = new Set(); // Avoid duplicates

    function addImage(src, alt = '', imgElement = null) {
      if (src && !seen.has(src)) {
        seen.add(src);
        const imgData = { src, alt };

        // Capture rendered dimensions if available
        if (imgElement) {
          const dims = getRenderedDimensions(imgElement);
          if (dims) {
            imgData.renderedWidth = dims.width;
            imgData.renderedHeight = dims.height;
          }
        }

        images.push(imgData);
      }
    }

    // Find picture elements first (they contain img as fallback)
    const pictures = node.querySelectorAll('picture');
    pictures.forEach(picture => {
      const src = getImageUrlFromPicture(picture);
      const img = picture.querySelector('img');
      const alt = img ? (img.getAttribute('alt') || '') : '';
      addImage(src, alt, img);
    });

    // Find all img elements (excluding those already in pictures)
    const imgs = node.querySelectorAll('img');
    imgs.forEach(img => {
      // Skip if this img is inside a picture we already processed
      if (img.closest('picture')) return;

      const src = getImageUrl(img);
      const alt = img.getAttribute('alt') || '';
      addImage(src, alt, img);
    });

    // Find figure elements that might have images
    const figures = node.querySelectorAll('figure');
    figures.forEach(figure => {
      const img = figure.querySelector('img');
      const picture = figure.querySelector('picture');
      const figcaption = figure.querySelector('figcaption');
      const alt = figcaption ? figcaption.textContent.trim() : '';

      if (picture) {
        const src = getImageUrlFromPicture(picture);
        const picImg = picture.querySelector('img');
        addImage(src, alt || (img ? img.getAttribute('alt') : ''), picImg || img);
      } else if (img && !img.closest('picture')) {
        const src = getImageUrl(img);
        addImage(src, alt || img.getAttribute('alt') || '', img);
      }
    });

    // Find SVG images (external, not inline)
    const svgs = node.querySelectorAll('svg[src], svg image, img[src$=".svg"]');
    svgs.forEach(svg => {
      const src = svg.getAttribute('src') || svg.getAttribute('href') || svg.getAttribute('xlink:href');
      if (src && isValidImageUrl(src)) {
        addImage(src, '');
      }
    });

    // Check for elements with background images
    const allElements = node.querySelectorAll('[style*="background"]');
    allElements.forEach(el => {
      const style = el.getAttribute('style');
      if (style) {
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
        if (bgMatch && isValidImageUrl(bgMatch[1])) {
          addImage(bgMatch[1], '');
        }
      }
    });

    return images;
  }

  /**
   * Calculate table cell image dimensions with intelligent sizing
   * Fits image proportionally within cell constraints while maintaining readability
   *
   * @param {number} intrinsicWidth - Image's natural width in pixels
   * @param {number} intrinsicHeight - Image's natural height in pixels
   * @param {number} maxCellWidth - Maximum cell width in mm
   * @param {number} maxCellHeight - Maximum cell height in mm (can be large for image-heavy tables)
   * @param {number|undefined} renderedWidth - Rendered width from HTML (if available)
   * @param {number|undefined} renderedHeight - Rendered height from HTML (if available)
   * @returns {{ width: number, height: number }} Dimensions in mm
   */
  function calculateCellImageDimensions(intrinsicWidth, intrinsicHeight, maxCellWidth, maxCellHeight, renderedWidth, renderedHeight) {
    const aspectRatio = intrinsicHeight / intrinsicWidth;
    const minWidth = 15; // Minimum width for visibility in cells
    const minHeight = 10; // Minimum height for visibility

    let targetWidth, targetHeight;

    // Strategy 1: Use rendered dimensions if available
    if (renderedWidth && renderedHeight && renderedWidth > 20 && renderedHeight > 20) {
      // Scale rendered size to fit cell, using cell width as reference
      // Assume typical table cell on screen is ~200-400px wide
      const cellWidthEstimate = 300;
      const displayProportion = Math.min(renderedWidth / cellWidthEstimate, 1.0);

      targetWidth = Math.max(displayProportion * maxCellWidth, minWidth);
      targetHeight = targetWidth * aspectRatio;
    }
    // Strategy 2: Intelligent sizing based on intrinsic dimensions
    else {
      // For cell images, use most of the available cell width
      // This ensures images are readable within the table context
      if (intrinsicWidth <= 100) {
        // Very small images - use minimum size
        targetWidth = minWidth;
      } else if (intrinsicWidth <= 300) {
        // Small to medium images - moderate size
        targetWidth = Math.min(maxCellWidth * 0.7, 40);
      } else {
        // Larger images - use most of cell width
        targetWidth = maxCellWidth * 0.9;
      }

      targetHeight = targetWidth * aspectRatio;
    }

    // Apply max width constraint
    if (targetWidth > maxCellWidth) {
      const scale = maxCellWidth / targetWidth;
      targetWidth = maxCellWidth;
      targetHeight = targetHeight * scale;
    }

    // Apply max height constraint
    if (targetHeight > maxCellHeight) {
      const scale = maxCellHeight / targetHeight;
      targetHeight = maxCellHeight;
      targetWidth = targetWidth * scale;
    }

    // Ensure minimum dimensions for readability
    if (targetWidth < minWidth && aspectRatio <= 3) {
      const scale = minWidth / targetWidth;
      targetWidth = minWidth;
      targetHeight = Math.min(targetHeight * scale, maxCellHeight);
    }

    if (targetHeight < minHeight && aspectRatio >= 0.33) {
      const scale = minHeight / targetHeight;
      targetHeight = minHeight;
      targetWidth = Math.min(targetWidth * scale, maxCellWidth);
    }

    return {
      width: Math.round(targetWidth * 100) / 100,
      height: Math.round(targetHeight * 100) / 100
    };
  }

  // ============================================
  // HTML to PDF Renderer
  // ============================================

  class PDFRenderer {
    constructor(doc, config) {
      this.doc = doc;
      this.config = config;
      this.y = config.page.marginTop;
      this.pageNum = 1;
      this.title = '';
      this.exportDate = '';
      this.contentWidth = config.page.width - config.page.marginLeft - config.page.marginRight;
      this.imageCache = new Map();
      this.imageStats = { success: 0, failed: 0 };
    }

    get availableHeight() {
      return this.config.page.height - this.config.page.marginBottom - this.y;
    }

    /**
     * Get the maximum usable height on a fresh page (full content area)
     * Used for calculating image dimensions without constraining to current page space
     */
    get maxPageContentHeight() {
      return this.config.page.height - this.config.page.marginTop - this.config.page.marginBottom;
    }

    checkPageBreak(neededHeight) {
      if (this.y + neededHeight > this.config.page.height - this.config.page.marginBottom) {
        this.addPage();
        return true;
      }
      return false;
    }

    addPage() {
      this.doc.addPage();
      this.pageNum++;
      this.y = this.config.page.marginTop;
    }

    setFont(style = 'normal', weight = 'normal') {
      const fontStyle = weight === 'bold' ? 'bold' : (style === 'italic' ? 'italic' : 'normal');
      this.doc.setFont('helvetica', fontStyle);
    }

    setColor(color) {
      this.doc.setTextColor(color[0], color[1], color[2]);
    }

    setFillColor(color) {
      this.doc.setFillColor(color[0], color[1], color[2]);
    }

    setDrawColor(color) {
      this.doc.setDrawColor(color[0], color[1], color[2]);
    }

    /**
     * Get the width of text including emojis
     * Used for accurate line breaking calculations
     */
    getTextWidthWithEmoji(text, fontSize) {
      if (!text) return 0;

      if (!hasEmoji(text)) {
        const safeText = sanitizeTextForPDF(text, false);
        return this.doc.getTextWidth(safeText);
      }

      let totalWidth = 0;
      const parts = splitTextAndEmojis(text);
      const emojiWidth = fontSize * 0.35; // mm per emoji

      for (const part of parts) {
        if (part.type === 'emoji') {
          totalWidth += emojiWidth + 0.3;
        } else {
          const safeText = sanitizeTextForPDF(part.content, false);
          totalWidth += this.doc.getTextWidth(safeText);
        }
      }

      return totalWidth;
    }

    /**
     * Render text with emoji support
     * Emojis are rendered as images, with fallback to text replacements
     */
    renderTextWithEmoji(text, x, y, fontSize, maxWidth = null) {
      if (!text) return;

      // Check for emojis
      if (!hasEmoji(text)) {
        // No emojis - render as plain text
        const safeText = sanitizeTextForPDF(text, false);
        if (safeText) {
          this.doc.text(safeText, x, y);
        }
        return;
      }

      // Split text into parts (text and emojis)
      const parts = splitTextAndEmojis(text);
      let currentX = x;
      const emojiSize = fontSize * 0.35; // Size in mm - consistent with width calc
      const maxX = maxWidth ? x + maxWidth : this.config.page.width - this.config.page.marginRight;

      for (const part of parts) {
        // Check if we've exceeded max width
        if (currentX >= maxX - 2) break;

        if (part.type === 'text') {
          // Render text part
          const safeText = sanitizeTextForPDF(part.content, false);
          if (safeText) {
            const textWidth = this.doc.getTextWidth(safeText);
            // Truncate if needed
            if (currentX + textWidth > maxX) {
              // Fit what we can
              let truncated = safeText;
              while (truncated.length > 0 && currentX + this.doc.getTextWidth(truncated) > maxX - 2) {
                truncated = truncated.slice(0, -1);
              }
              if (truncated) {
                this.doc.text(truncated, currentX, y);
                currentX += this.doc.getTextWidth(truncated);
              }
              break;
            }
            this.doc.text(safeText, currentX, y);
            currentX += textWidth;
          }
        } else if (part.type === 'emoji') {
          // Check if emoji fits
          if (currentX + emojiSize > maxX) break;

          // Try to render emoji as image
          const emojiImg = renderEmojiToImage(part.content, fontSize);

          if (emojiImg) {
            try {
              this.doc.addImage(emojiImg, 'PNG', currentX, y - emojiSize * 0.75, emojiSize, emojiSize);
              currentX += emojiSize + 0.3;
            } catch (e) {
              // Image failed, use text fallback
              const fallback = getEmojiFallbackText(part.content);
              if (fallback) {
                this.doc.text(fallback, currentX, y);
                currentX += this.doc.getTextWidth(fallback);
              }
            }
          } else {
            // Emoji rendering failed, use text fallback
            const fallback = getEmojiFallbackText(part.content);
            if (fallback) {
              const fallbackWidth = this.doc.getTextWidth(fallback);
              if (currentX + fallbackWidth <= maxX) {
                this.doc.text(fallback, currentX, y);
                currentX += fallbackWidth;
              }
            }
          }
        }
      }
    }

    /**
     * Render text with word wrapping and emoji support
     */
    renderText(text, fontSize, lineHeight, options = {}) {
      const { indent = 0, color = this.config.colors.text, bold = false, italic = false } = options;

      if (!text) return;

      this.doc.setFontSize(fontSize);
      this.setColor(color);
      this.setFont(italic ? 'italic' : 'normal', bold ? 'bold' : 'normal');

      const maxWidth = this.contentWidth - indent;
      const lineHeightMm = fontSize * lineHeight * 0.3528;

      // Split text into lines while preserving emojis
      const lines = this.splitTextIntoLines(text, maxWidth, fontSize);

      for (const line of lines) {
        this.checkPageBreak(lineHeightMm);
        this.renderTextWithEmoji(line, this.config.page.marginLeft + indent, this.y, fontSize, maxWidth);
        this.y += lineHeightMm;
      }
    }

    /**
     * Split text into lines that fit within maxWidth
     * Uses accurate width calculation including emojis
     */
    splitTextIntoLines(text, maxWidth, fontSize) {
      if (!text) return [];

      // For text without emojis, use jsPDF's built-in method (more reliable)
      if (!hasEmoji(text)) {
        const safeText = sanitizeTextForPDF(text, false);
        if (!safeText) return [];
        return this.doc.splitTextToSize(safeText, maxWidth);
      }

      // For text with emojis, do word-by-word splitting
      const emojiWidth = fontSize * 0.35 + 0.3; // Consistent with rendering
      const words = [];

      // First, split the text into words while keeping emojis as separate tokens
      const parts = splitTextAndEmojis(text);

      for (const part of parts) {
        if (part.type === 'emoji') {
          words.push({ text: part.content, isEmoji: true, width: emojiWidth });
        } else {
          // Split on whitespace but preserve the spaces
          const textWords = part.content.split(/(\s+)/);
          for (const word of textWords) {
            if (word) {
              const safeWord = sanitizeTextForPDF(word, false);
              const width = safeWord ? this.doc.getTextWidth(safeWord) : 0;
              words.push({ text: word, isEmoji: false, width: width, safe: safeWord });
            }
          }
        }
      }

      // Now build lines
      const lines = [];
      let currentLine = [];
      let currentWidth = 0;

      for (const word of words) {
        const isSpace = !word.isEmoji && /^\s+$/.test(word.text);

        // If adding this word would exceed maxWidth
        if (currentWidth + word.width > maxWidth && currentLine.length > 0 && !isSpace) {
          // Save current line and start new one
          const lineText = currentLine.map(w => w.text).join('');
          if (lineText.trim()) {
            lines.push(lineText.trim());
          }
          currentLine = isSpace ? [] : [word];
          currentWidth = isSpace ? 0 : word.width;
        } else {
          currentLine.push(word);
          currentWidth += word.width;
        }
      }

      // Don't forget the last line
      if (currentLine.length > 0) {
        const lineText = currentLine.map(w => w.text).join('');
        if (lineText.trim()) {
          lines.push(lineText.trim());
        }
      }

      return lines;
    }

    // Render frontmatter
    renderFrontmatter(title, sourceUrl, date, author, siteName) {
      const safeAuthor = sanitizeTextForPDF(author, false);
      const safeSiteName = sanitizeTextForPDF(siteName, false);

      this.title = sanitizeTextForPDF(title, false); // ASCII only for headers
      this.exportDate = date; // Store for header/footer use

      // Title
      this.doc.setFontSize(this.config.fonts.h1.size);
      this.setColor(this.config.colors.heading);
      this.setFont('normal', 'bold');

      const titleLineHeight = this.config.fonts.h1.size * this.config.fonts.h1.lineHeight * 0.3528;
      const titleLines = this.splitTextIntoLines(title, this.contentWidth, this.config.fonts.h1.size);

      for (const line of titleLines) {
        this.checkPageBreak(titleLineHeight);
        this.renderTextWithEmoji(line, this.config.page.marginLeft, this.y, this.config.fonts.h1.size, this.contentWidth);
        this.y += titleLineHeight;
      }

      this.y += 3;

      // Meta info
      this.doc.setFontSize(this.config.fonts.meta.size);
      this.setColor(this.config.colors.meta);
      this.setFont('normal', 'normal');

      const metaLineHeight = this.config.fonts.meta.size * this.config.fonts.meta.lineHeight * 0.3528;

      // Helper to truncate text to fit width
      const truncateToFit = (prefix, text) => {
        let display = prefix + text;
        while (this.doc.getTextWidth(display) > this.contentWidth && text.length > 10) {
          text = text.substring(0, text.length - 4) + '...';
          display = prefix + text;
        }
        return display;
      };

      // Source
      const sourceText = truncateToFit('Source: ', sourceUrl);
      this.doc.text(sourceText, this.config.page.marginLeft, this.y);
      this.y += metaLineHeight;

      // Date
      this.doc.text(`Exported: ${date}`, this.config.page.marginLeft, this.y);
      this.y += metaLineHeight;

      if (safeAuthor) {
        const authorText = truncateToFit('Author: ', safeAuthor);
        this.doc.text(authorText, this.config.page.marginLeft, this.y);
        this.y += metaLineHeight;
      }

      if (safeSiteName) {
        const siteText = truncateToFit('Site: ', safeSiteName);
        this.doc.text(siteText, this.config.page.marginLeft, this.y);
        this.y += metaLineHeight;
      }

      // Separator line
      this.y += 3;
      this.setDrawColor([200, 200, 200]);
      this.doc.setLineWidth(0.3);
      this.doc.line(
        this.config.page.marginLeft, this.y,
        this.config.page.width - this.config.page.marginRight, this.y
      );
      this.y += this.config.spacing.heading;
    }

    // Render heading
    renderHeading(text, level) {
      if (!text) return;

      const fontConfig = this.config.fonts[`h${level}`] || this.config.fonts.h3;

      this.y += this.config.spacing.heading / 2;
      this.checkPageBreak(fontConfig.size * fontConfig.lineHeight * 0.3528 + 5);

      this.doc.setFontSize(fontConfig.size);
      this.setColor(this.config.colors.heading);
      this.setFont('normal', 'bold');

      const lines = this.splitTextIntoLines(text, this.contentWidth, fontConfig.size);
      const lineHeight = fontConfig.size * fontConfig.lineHeight * 0.3528;

      for (const line of lines) {
        this.checkPageBreak(lineHeight);
        this.renderTextWithEmoji(line, this.config.page.marginLeft, this.y, fontConfig.size, this.contentWidth);
        this.y += lineHeight;
      }

      this.y += this.config.spacing.heading / 2;
    }

    // Render paragraph
    renderParagraph(text) {
      if (!text || !text.trim()) return;

      this.renderText(
        text,
        this.config.fonts.body.size,
        this.config.fonts.body.lineHeight,
        { color: this.config.colors.text }
      );
      this.y += this.config.spacing.paragraph;
    }

    // Render code block
    renderCodeBlock(code) {
      const safeCode = sanitizeTextForPDF(code, false);
      if (!safeCode) return;

      const fontSize = this.config.fonts.code.size;
      const lineHeight = this.config.fonts.code.lineHeight;
      const lineHeightMm = fontSize * lineHeight * 0.3528;
      const padding = 3;
      const maxWidth = this.contentWidth - (padding * 2);

      this.doc.setFontSize(fontSize);
      this.doc.setFont('courier', 'normal');

      const lines = safeCode.split('\n');
      const blockHeight = (lines.length * lineHeightMm) + (padding * 2);

      this.checkPageBreak(Math.min(blockHeight, 50));

      // Background
      this.setFillColor(this.config.colors.codeBackground);
      const bgHeight = Math.min(blockHeight, this.availableHeight - 5);
      this.doc.rect(this.config.page.marginLeft, this.y - 2, this.contentWidth, bgHeight, 'F');

      this.y += padding;
      this.setColor(this.config.colors.code);

      for (const line of lines) {
        this.checkPageBreak(lineHeightMm);
        let displayLine = line;
        // Truncate line if it exceeds max width
        while (displayLine.length > 0 && this.doc.getTextWidth(displayLine) > maxWidth) {
          displayLine = displayLine.substring(0, displayLine.length - 1);
        }
        if (displayLine.length < line.length && displayLine.length > 3) {
          displayLine = displayLine.substring(0, displayLine.length - 3) + '...';
        }
        this.doc.text(displayLine, this.config.page.marginLeft + padding, this.y);
        this.y += lineHeightMm;
      }

      this.y += padding + this.config.spacing.codeBlock;
    }

    // Render blockquote
    renderBlockquote(text) {
      if (!text) return;

      const indent = 8;
      const maxWidth = this.contentWidth - indent;
      const lineHeightMm = this.config.fonts.body.size * this.config.fonts.body.lineHeight * 0.3528;

      this.doc.setFontSize(this.config.fonts.body.size);
      this.setColor(this.config.colors.blockquoteText);
      this.setFont('italic', 'normal');

      const lines = this.splitTextIntoLines(text, maxWidth, this.config.fonts.body.size);

      this.checkPageBreak(Math.min(lines.length * lineHeightMm, 30));

      const startY = this.y - 2;
      this.setDrawColor(this.config.colors.blockquoteBorder);
      this.doc.setLineWidth(1);

      for (const line of lines) {
        this.checkPageBreak(lineHeightMm);
        this.renderTextWithEmoji(line, this.config.page.marginLeft + indent, this.y, this.config.fonts.body.size, maxWidth);
        this.y += lineHeightMm;
      }

      this.doc.line(this.config.page.marginLeft + 2, startY, this.config.page.marginLeft + 2, this.y);
      this.y += this.config.spacing.blockquote;
    }

    // Render list item
    renderListItem(text, ordered, index, indent = 0) {
      if (!text) return;

      const bullet = ordered ? `${index}.` : '-';
      const indentMm = indent * 5 + 5;

      this.doc.setFontSize(this.config.fonts.body.size);
      this.setColor(this.config.colors.text);
      this.setFont('normal', 'normal');

      const lineHeightMm = this.config.fonts.body.size * this.config.fonts.body.lineHeight * 0.3528;
      this.checkPageBreak(lineHeightMm);

      this.doc.text(bullet, this.config.page.marginLeft + indentMm - 4, this.y);

      const maxWidth = this.contentWidth - indentMm - 2;
      const lines = this.splitTextIntoLines(text, maxWidth, this.config.fonts.body.size);

      for (let i = 0; i < lines.length; i++) {
        if (i > 0) this.checkPageBreak(lineHeightMm);
        this.renderTextWithEmoji(lines[i], this.config.page.marginLeft + indentMm, this.y, this.config.fonts.body.size, maxWidth);
        this.y += lineHeightMm;
      }

      this.y += this.config.spacing.list;
    }

    /**
     * Calculate optimal image dimensions for PDF
     * Uses rendered dimensions from HTML when available, falls back to intelligent sizing
     * based on intrinsic image dimensions
     *
     * @param {number} intrinsicWidth - Image's natural width in pixels
     * @param {number} intrinsicHeight - Image's natural height in pixels
     * @param {number|undefined} renderedWidth - Rendered width from HTML (if available)
     * @param {number|undefined} renderedHeight - Rendered height from HTML (if available)
     * @returns {{ width: number, height: number }} Dimensions in mm
     */
    calculateImageDimensions(intrinsicWidth, intrinsicHeight, renderedWidth, renderedHeight) {
      const maxWidthMm = this.contentWidth * this.config.image.maxWidthPercent;
      // Use full page content height, NOT remaining space - this prevents image compression
      // when there's limited space left on current page. The caller will handle page breaks.
      const maxHeightMm = Math.min(this.config.image.maxHeightMm, this.maxPageContentHeight - 15);
      const minWidthMm = this.config.image.minWidthMm;
      const minHeightMm = this.config.image.minHeightMm;

      // Calculate aspect ratio from intrinsic dimensions
      const aspectRatio = intrinsicHeight / intrinsicWidth;

      let targetWidthMm;
      let targetHeightMm;

      // Strategy 1: Use rendered dimensions if available and reasonable
      if (renderedWidth && renderedHeight && renderedWidth > 20 && renderedHeight > 20) {
        // Convert rendered pixels to a proportion of typical screen width (~1200px)
        // This gives us a sense of how big the image was intended to be displayed
        const screenWidthEstimate = 800; // Typical article content width
        const displayProportion = Math.min(renderedWidth / screenWidthEstimate, 1.0);

        // Map this proportion to PDF content width
        targetWidthMm = Math.max(displayProportion * this.contentWidth, minWidthMm);
        targetHeightMm = targetWidthMm * aspectRatio;
      }
      // Strategy 2: Intelligent sizing based on intrinsic dimensions
      else {
        // Categorize images by their intrinsic size
        if (intrinsicWidth <= 100 || intrinsicHeight <= 100) {
          // Very small images (icons, bullets) - scale up to minimum readable size
          targetWidthMm = Math.max(minWidthMm, 30);
          targetHeightMm = targetWidthMm * aspectRatio;
        } else if (intrinsicWidth <= 300) {
          // Small images (thumbnails, small graphics) - moderate size
          targetWidthMm = Math.min(60, maxWidthMm * 0.4);
          targetHeightMm = targetWidthMm * aspectRatio;
        } else if (intrinsicWidth <= 600) {
          // Medium images - good readable size
          targetWidthMm = Math.min(100, maxWidthMm * 0.65);
          targetHeightMm = targetWidthMm * aspectRatio;
        } else if (intrinsicWidth <= 1200) {
          // Large images (article images, screenshots) - most of content width
          targetWidthMm = maxWidthMm * 0.85;
          targetHeightMm = targetWidthMm * aspectRatio;
        } else {
          // Very large images (hero images, full-width) - full content width
          targetWidthMm = maxWidthMm;
          targetHeightMm = targetWidthMm * aspectRatio;
        }

        // Adjust for aspect ratio - very wide or very tall images need special handling
        if (aspectRatio < 0.3) {
          // Very wide image (banner style) - use full width, accept short height
          targetWidthMm = maxWidthMm;
          targetHeightMm = targetWidthMm * aspectRatio;
        } else if (aspectRatio > 2.5) {
          // Very tall image (infographic style) - limit width to prevent huge height
          targetWidthMm = Math.min(targetWidthMm, maxWidthMm * 0.5);
          targetHeightMm = targetWidthMm * aspectRatio;
        }
      }

      // Apply constraints - ensure we don't exceed max dimensions
      if (targetWidthMm > maxWidthMm) {
        const scale = maxWidthMm / targetWidthMm;
        targetWidthMm = maxWidthMm;
        targetHeightMm = targetHeightMm * scale;
      }

      if (targetHeightMm > maxHeightMm) {
        const scale = maxHeightMm / targetHeightMm;
        targetHeightMm = maxHeightMm;
        targetWidthMm = targetWidthMm * scale;
      }

      // Ensure minimum dimensions for readability
      if (targetWidthMm < minWidthMm && aspectRatio <= 3) {
        const scale = minWidthMm / targetWidthMm;
        targetWidthMm = minWidthMm;
        targetHeightMm = targetHeightMm * scale;
        // Re-check height constraint after scaling up
        if (targetHeightMm > maxHeightMm) {
          const hScale = maxHeightMm / targetHeightMm;
          targetHeightMm = maxHeightMm;
          targetWidthMm = targetWidthMm * hScale;
        }
      }

      if (targetHeightMm < minHeightMm && aspectRatio >= 0.33) {
        const scale = minHeightMm / targetHeightMm;
        targetHeightMm = minHeightMm;
        targetWidthMm = targetWidthMm * scale;
        // Re-check width constraint after scaling up
        if (targetWidthMm > maxWidthMm) {
          const wScale = maxWidthMm / targetWidthMm;
          targetWidthMm = maxWidthMm;
          targetHeightMm = targetHeightMm * wScale;
        }
      }

      return {
        width: Math.round(targetWidthMm * 100) / 100,
        height: Math.round(targetHeightMm * 100) / 100
      };
    }

    // Render image with intelligent sizing
    async renderImage(src, alt, baseUrl, renderedWidth, renderedHeight) {
      let imgUrl = src;

      // Resolve relative URLs
      if (!imgUrl.startsWith('data:') && !imgUrl.startsWith('http')) {
        try {
          imgUrl = new URL(imgUrl, baseUrl).href;
        } catch (e) {
          this.imageStats.failed++;
          return;
        }
      }

      // Try to get image from cache or fetch it
      let imgData = this.imageCache.get(imgUrl);
      if (!imgData) {
        // Fetch image for PDF (passes through JPEG/PNG, converts others to JPEG)
        imgData = await fetchImageForPdf(imgUrl);

        if (imgData) {
          this.imageCache.set(imgUrl, imgData);
        }
      }

      if (!imgData) {
        this.imageStats.failed++;
        return;
      }

      try {
        // Get intrinsic image dimensions from jsPDF
        const imgProps = this.doc.getImageProperties(imgData);
        const intrinsicWidth = imgProps.width;
        const intrinsicHeight = imgProps.height;

        // Skip tiny images (likely tracking pixels or spacers)
        if (intrinsicWidth < 10 || intrinsicHeight < 10) {
          return;
        }

        // Calculate optimal dimensions using full page height (not remaining space)
        // This ensures images maintain their proper size and aren't compressed
        const dimensions = this.calculateImageDimensions(
          intrinsicWidth,
          intrinsicHeight,
          renderedWidth,
          renderedHeight
        );

        let widthMm = dimensions.width;
        let heightMm = dimensions.height;

        // Check if image fits on current page - if not, move to new page FIRST
        // This is crucial: we move to a new page before rendering to ensure
        // the image gets full page space rather than being compressed
        const totalNeededHeight = heightMm + 10; // image + spacing

        if (this.availableHeight < totalNeededHeight) {
          // Not enough space on current page - start a new page
          this.addPage();
        }

        // Safety check: if image is taller than a full page, scale it down
        // This only happens for extremely tall images that exceed page capacity
        if (heightMm > this.maxPageContentHeight - 10) {
          const scale = (this.maxPageContentHeight - 10) / heightMm;
          heightMm = this.maxPageContentHeight - 10;
          widthMm = widthMm * scale;
        }

        // Center image horizontally
        const x = this.config.page.marginLeft + (this.contentWidth - widthMm) / 2;

        // Add image to PDF
        this.doc.addImage(imgData, x, this.y, widthMm, heightMm);
        this.y += heightMm + 2;

        // Add caption if alt text exists
        if (alt) {
          const safeAlt = sanitizeTextForPDF(alt, false);
          if (safeAlt) {
            this.doc.setFontSize(this.config.fonts.meta.size);
            this.setColor(this.config.colors.meta);
            this.setFont('italic', 'normal');

            const captionLines = this.doc.splitTextToSize(safeAlt, this.contentWidth);
            for (const line of captionLines) {
              const captionX = this.config.page.marginLeft + (this.contentWidth - this.doc.getTextWidth(line)) / 2;
              this.doc.text(line, captionX, this.y);
              this.y += this.config.fonts.meta.size * 0.4;
            }
          }
        }

        this.y += this.config.spacing.image;
        this.imageStats.success++;

      } catch (e) {
        // Image should be JPEG/PNG from fetchImageForPdf
        console.warn('Failed to render image:', e.message, 'format:', detectImageFormat(imgData));
        this.imageStats.failed++;
      }
    }

    // Render table
    /**
     * Render table with support for images in cells
     * Properly calculates row heights based on actual image dimensions
     *
     * @param {Array} rows - Array of row arrays containing cell text
     * @param {Object} cellImages - Map of 'row-col' to array of image objects with src, alt, renderedWidth, renderedHeight
     * @param {string} baseUrl - Base URL for resolving relative image URLs
     */
    async renderTable(rows, cellImages = {}, baseUrl = '') {
      if (!rows || rows.length === 0) return;

      const fontSize = this.config.fonts.body.size - 1;
      const lineHeight = fontSize * 1.3 * 0.3528;
      const cellPadding = 3;
      const numCols = Math.max(...rows.map(r => r.length));
      const colWidth = this.contentWidth / numCols;
      const maxCellWidth = colWidth - cellPadding * 2;

      // Maximum height for images in a cell - allow taller images for better visibility
      // This should be generous to avoid compression, but not exceed page limits
      const maxImageHeightInCell = Math.min(80, this.maxPageContentHeight * 0.4);

      // Pre-load all cell images AND pre-calculate their dimensions
      const loadedImages = {};
      const cellImageDimensions = {}; // Store pre-calculated dimensions

      for (const [cellKey, images] of Object.entries(cellImages)) {
        loadedImages[cellKey] = [];
        cellImageDimensions[cellKey] = [];

        for (const imgInfo of images) {
          let imgUrl = imgInfo.src;
          if (!imgUrl.startsWith('data:') && !imgUrl.startsWith('http') && baseUrl) {
            try {
              imgUrl = new URL(imgUrl, baseUrl).href;
            } catch (e) {
              continue;
            }
          }

          let imgData = this.imageCache.get(imgUrl);
          if (!imgData) {
            // Fetch image for PDF (passes through JPEG/PNG, converts others to JPEG)
            imgData = await fetchImageForPdf(imgUrl);

            if (imgData) {
              this.imageCache.set(imgUrl, imgData);
            }
          }

          if (imgData) {
            // Get intrinsic dimensions and pre-calculate display dimensions
            try {
              const imgProps = this.doc.getImageProperties(imgData);

              // Calculate dimensions using intelligent sizing with rendered dimensions
              const dims = calculateCellImageDimensions(
                imgProps.width,
                imgProps.height,
                maxCellWidth - 2,
                maxImageHeightInCell,
                imgInfo.renderedWidth,
                imgInfo.renderedHeight
              );

              loadedImages[cellKey].push({
                data: imgData,
                alt: imgInfo.alt
              });

              cellImageDimensions[cellKey].push(dims);
            } catch (e) {
              console.warn('Failed to get image properties:', e);
            }
          }
        }
      }

      this.doc.setFontSize(fontSize);

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const isHeader = rowIdx === 0;

        // Calculate ACTUAL row height based on pre-calculated image dimensions
        let maxCellHeight = lineHeight + cellPadding * 2;

        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cellKey = `${rowIdx}-${colIdx}`;
          const cellImgDims = cellImageDimensions[cellKey] || [];

          if (cellImgDims.length > 0) {
            // Sum up actual image heights plus spacing between images
            let totalImgHeight = 0;
            for (const dims of cellImgDims) {
              totalImgHeight += dims.height + 2; // 2mm spacing between images
            }
            // Add text line height and padding
            const totalCellHeight = totalImgHeight + lineHeight + cellPadding * 2;
            maxCellHeight = Math.max(maxCellHeight, totalCellHeight);
          }
        }

        // Check if row fits on current page - if not, move to new page
        // This ensures rows with tall images don't get cut off
        if (this.availableHeight < maxCellHeight + 5) {
          this.addPage();
        }

        const rowStartY = this.y;

        // Row background
        if (isHeader) {
          this.setFillColor(this.config.colors.tableHeader);
        } else if (rowIdx % 2 === 0) {
          this.setFillColor(this.config.colors.tableAltRow);
        } else {
          this.setFillColor([255, 255, 255]);
        }

        this.doc.rect(this.config.page.marginLeft, this.y, this.contentWidth, maxCellHeight, 'F');

        // Cell borders
        this.setDrawColor(this.config.colors.tableBorder);
        this.doc.setLineWidth(0.2);
        this.doc.rect(this.config.page.marginLeft, this.y, this.contentWidth, maxCellHeight, 'S');

        // Vertical lines between columns
        for (let colIdx = 1; colIdx < numCols; colIdx++) {
          const x = this.config.page.marginLeft + colIdx * colWidth;
          this.doc.line(x, this.y, x, this.y + maxCellHeight);
        }

        // Render each cell
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cellKey = `${rowIdx}-${colIdx}`;
          const cellImgs = loadedImages[cellKey] || [];
          const cellImgDims = cellImageDimensions[cellKey] || [];
          const cellX = this.config.page.marginLeft + colIdx * colWidth + cellPadding;
          let cellY = rowStartY + cellPadding;

          // Render images first using pre-calculated dimensions
          for (let imgIdx = 0; imgIdx < cellImgs.length; imgIdx++) {
            const img = cellImgs[imgIdx];
            const dims = cellImgDims[imgIdx];

            if (!dims) continue;

            try {
              const imgWidth = dims.width;
              const imgHeight = dims.height;

              // Center image horizontally in cell
              const imgX = cellX + (maxCellWidth - imgWidth) / 2;
              this.doc.addImage(img.data, imgX, cellY, imgWidth, imgHeight);
              cellY += imgHeight + 2; // 2mm spacing between images
              this.imageStats.success++;
            } catch (e) {
              this.imageStats.failed++;
            }
          }

          // Render text below images
          const cellText = sanitizeTextForPDF((row[colIdx] || '').toString(), true);
          if (cellText) {
            this.setColor(this.config.colors.text);
            this.setFont('normal', isHeader ? 'bold' : 'normal');

            // Handle text that might be too wide for cell
            const safeText = sanitizeTextForPDF(cellText, false);
            let displayText = safeText;
            while (displayText.length > 0 && this.doc.getTextWidth(displayText) > maxCellWidth) {
              displayText = displayText.slice(0, -1);
            }
            if (displayText.length < safeText.length && displayText.length > 3) {
              displayText = displayText.slice(0, -3) + '...';
            }
            this.doc.text(displayText, cellX, cellY + lineHeight);
          }
        }

        this.y += maxCellHeight;
      }

      this.y += this.config.spacing.paragraph;
    }

    // Render horizontal rule
    renderHR() {
      this.y += 3;
      this.checkPageBreak(5);
      this.setDrawColor([200, 200, 200]);
      this.doc.setLineWidth(0.3);
      this.doc.line(
        this.config.page.marginLeft, this.y,
        this.config.page.width - this.config.page.marginRight, this.y
      );
      this.y += 5;
    }

    /**
     * Render a link embed/bookmark card
     * Displays as a styled box with title, description, and URL
     */
    renderLinkEmbed(url, title, description, domain) {
      if (!url || !title) return;

      const boxPadding = 4;
      const lineHeight = this.config.fonts.body.size * 1.3 * 0.3528;
      const smallLineHeight = this.config.fonts.meta.size * 1.3 * 0.3528;

      // Calculate box height based on content
      let boxHeight = boxPadding * 2;

      // Title (may wrap)
      this.doc.setFontSize(this.config.fonts.body.size);
      this.doc.setFont('helvetica', 'bold');
      const titleMaxWidth = this.contentWidth - boxPadding * 2;
      const titleLines = this.doc.splitTextToSize(sanitizeTextForPDF(title, false), titleMaxWidth);
      boxHeight += titleLines.length * lineHeight;

      // Description (if present)
      let descLines = [];
      if (description) {
        this.doc.setFontSize(this.config.fonts.meta.size);
        this.doc.setFont('helvetica', 'normal');
        const safeDesc = sanitizeTextForPDF(description, false);
        descLines = this.doc.splitTextToSize(safeDesc, titleMaxWidth);
        // Limit to 2 lines
        if (descLines.length > 2) {
          descLines = descLines.slice(0, 2);
          descLines[1] = descLines[1].substring(0, descLines[1].length - 3) + '...';
        }
        boxHeight += descLines.length * smallLineHeight + 2;
      }

      // Domain/URL line
      boxHeight += smallLineHeight + 2;

      // Check page break
      this.checkPageBreak(boxHeight + 8);

      const boxX = this.config.page.marginLeft;
      const boxY = this.y;
      const boxWidth = this.contentWidth;

      // Draw box background
      this.doc.setFillColor(248, 249, 250); // Light gray background
      this.doc.setDrawColor(200, 200, 200); // Border color
      this.doc.setLineWidth(0.3);
      this.doc.roundedRect(boxX, boxY, boxWidth, boxHeight, 2, 2, 'FD');

      // Draw left accent bar
      this.doc.setFillColor(66, 133, 244); // Blue accent
      this.doc.rect(boxX, boxY, 2, boxHeight, 'F');

      let currentY = boxY + boxPadding;

      // Render title
      this.doc.setFontSize(this.config.fonts.body.size);
      this.doc.setFont('helvetica', 'bold');
      this.doc.setTextColor(0, 102, 204); // Link blue
      for (const line of titleLines) {
        this.doc.text(line, boxX + boxPadding + 2, currentY + lineHeight * 0.7);
        currentY += lineHeight;
      }

      // Render description
      if (descLines.length > 0) {
        currentY += 1;
        this.doc.setFontSize(this.config.fonts.meta.size);
        this.doc.setFont('helvetica', 'normal');
        this.doc.setTextColor(85, 85, 85); // Gray text
        for (const line of descLines) {
          this.doc.text(line, boxX + boxPadding + 2, currentY + smallLineHeight * 0.7);
          currentY += smallLineHeight;
        }
      }

      // Render domain
      currentY += 2;
      this.doc.setFontSize(this.config.fonts.meta.size);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setTextColor(128, 128, 128); // Lighter gray
      const domainText = domain || url;
      let displayDomain = domainText;
      while (this.doc.getTextWidth(displayDomain) > titleMaxWidth && displayDomain.length > 10) {
        displayDomain = displayDomain.substring(0, displayDomain.length - 4) + '...';
      }
      this.doc.text(displayDomain, boxX + boxPadding + 2, currentY + smallLineHeight * 0.7);

      // Add clickable link over the entire box
      this.doc.link(boxX, boxY, boxWidth, boxHeight, { url: url });

      this.y = boxY + boxHeight + this.config.spacing.paragraph;
    }

    // Add headers and footers
    addHeadersFooters() {
      const totalPages = this.doc.getNumberOfPages();
      const footerY = this.config.page.height - 10;
      const headerY = 12;
      const leftX = this.config.page.marginLeft;
      const rightX = this.config.page.width - this.config.page.marginRight;

      for (let i = 1; i <= totalPages; i++) {
        this.doc.setPage(i);

        // ========== FOOTER ==========
        this.doc.setFontSize(this.config.fonts.footer.size);
        this.doc.setFont('helvetica', 'normal');
        this.doc.setTextColor(128, 128, 128);

        // Footer Left: Attribution with link
        const attributionText = 'Exported by Super Webpage Scraper';
        const attributionUrl = 'https://github.com/VegaStack/tools-super-webpage-scraper';

        this.doc.text(attributionText, leftX, footerY);

        // Add clickable link annotation over the attribution text
        const attrTextWidth = this.doc.getTextWidth(attributionText);
        const attrTextHeight = this.config.fonts.footer.size * 0.3528;
        this.doc.link(leftX, footerY - attrTextHeight, attrTextWidth, attrTextHeight + 2, { url: attributionUrl });

        // Footer Right: Page number
        const pageText = `Page ${i} of ${totalPages}`;
        const pageTextWidth = this.doc.getTextWidth(pageText);
        this.doc.text(pageText, rightX - pageTextWidth, footerY);

        // ========== HEADER (skip first page) ==========
        if (i > 1) {
          this.doc.setFontSize(this.config.fonts.footer.size);
          this.doc.setFont('helvetica', 'normal');
          this.doc.setTextColor(128, 128, 128);

          // Header Right: Date (render first to know its width)
          let dateText = '';
          if (this.exportDate) {
            dateText = this.exportDate;
            const dateTextWidth = this.doc.getTextWidth(dateText);
            this.doc.text(dateText, rightX - dateTextWidth, headerY);
          }

          // Header Left: Title (can wrap to multiple lines, but don't overlap with date)
          if (this.title) {
            // Calculate max width for title (leave space for date + gap)
            const dateWidth = dateText ? this.doc.getTextWidth(dateText) + 10 : 0;
            const maxTitleWidth = this.contentWidth - dateWidth;

            // Split title into lines that fit within maxTitleWidth
            const titleLines = [];
            let remainingTitle = this.title;

            // First line
            let currentLine = '';
            const words = remainingTitle.split(' ');

            for (const word of words) {
              const testLine = currentLine ? currentLine + ' ' + word : word;
              if (this.doc.getTextWidth(testLine) <= maxTitleWidth) {
                currentLine = testLine;
              } else {
                if (currentLine) {
                  titleLines.push(currentLine);
                }
                currentLine = word;
                // Only allow 2 lines max for header title
                if (titleLines.length >= 1) {
                  // Truncate with ellipsis if needed
                  while (currentLine.length > 3 && this.doc.getTextWidth(currentLine + '...') > maxTitleWidth) {
                    currentLine = currentLine.slice(0, -1);
                  }
                  currentLine = currentLine + '...';
                  titleLines.push(currentLine);
                  currentLine = '';
                  break;
                }
              }
            }

            if (currentLine) {
              // Check if this last part needs truncation
              if (titleLines.length >= 1 && this.doc.getTextWidth(currentLine) > maxTitleWidth) {
                while (currentLine.length > 3 && this.doc.getTextWidth(currentLine + '...') > maxTitleWidth) {
                  currentLine = currentLine.slice(0, -1);
                }
                currentLine = currentLine + '...';
              }
              titleLines.push(currentLine);
            }

            // Render title lines
            const lineHeight = this.config.fonts.footer.size * 0.4;
            for (let lineIdx = 0; lineIdx < Math.min(titleLines.length, 2); lineIdx++) {
              this.doc.text(titleLines[lineIdx], leftX, headerY + (lineIdx * lineHeight));
            }
          }
        }
      }
    }
  }

  // ============================================
  // Table Parser with Image Support
  // ============================================

  /**
   * Parse a table element, extracting both text and images from cells
   * Returns { rows: [[cell contents]], cellImages: { 'row-col': [image data] } }
   */
  function parseTable(tableNode) {
    const rows = [];
    const cellImages = {};

    const trElements = tableNode.querySelectorAll('tr');

    trElements.forEach((tr, rowIndex) => {
      const cells = [];
      const cellElements = tr.querySelectorAll('th, td');

      cellElements.forEach((cell, colIndex) => {
        // Get text content (without image alt text causing duplication)
        let textContent = '';
        const textNodes = [];

        // Walk through child nodes to get text
        function extractText(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node.textContent);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            // Skip img, picture, figure tags for text extraction
            if (!['img', 'picture', 'figure', 'svg'].includes(tag)) {
              for (const child of node.childNodes) {
                extractText(child);
              }
            }
          }
        }

        extractText(cell);
        textContent = textNodes.join(' ').replace(/\s+/g, ' ').trim();
        cells.push(textContent);

        // Find ALL images in this cell using comprehensive finder
        const images = findAllImages(cell);
        if (images.length > 0) {
          const cellKey = `${rowIndex}-${colIndex}`;
          cellImages[cellKey] = images;
        }
      });

      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    return { rows, cellImages };
  }

  // ============================================
  // HTML Parser
  // ============================================

  /**
   * Check if text looks like article metadata that should be filtered
   * (read time, dates, author info that appears after title)
   */
  function isMetadataText(text) {
    if (!text || text.length > 50) return false; // Metadata is usually short

    const metadataPatterns = [
      /^\d+\s*min\s*read$/i,           // "4 min read"
      /^\d+\s*minute\s*read$/i,        // "4 minute read"
      /^read\s*time:?\s*\d+/i,         // "Read time: 4 min"
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s*\d{4}$/i,  // "Jul 22, 2025"
      /^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i,    // "22 Jul 2025"
      /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/,  // "07/22/2025" or "22-07-2025"
      /^(follow|following|subscribe)$/i,       // Social buttons text
      /^\d+\s*(claps?|likes?|comments?)$/i,    // "49 claps"
      /^share$/i,
      /^save$/i,
      /^listen$/i,
      /^more$/i,
    ];

    return metadataPatterns.some(pattern => pattern.test(text.trim()));
  }

  /**
   * Check if an image looks like a small avatar/profile picture
   */
  function isAvatarImage(width, height, src) {
    // Avatar images are typically small and square-ish
    if (width && height) {
      const isSmall = width <= 80 && height <= 80;
      const isSquarish = Math.abs(width - height) < 20;
      if (isSmall && isSquarish) return true;
    }

    // Check URL patterns for avatar/profile images
    // Note: Patterns must be specific to avoid false positives on CDN URLs
    // e.g., /user.*image/i would incorrectly match "framerusercontent.com/images/"
    if (src) {
      const avatarPatterns = [
        /avatar/i,
        /profile[-_]?(pic|img|image|photo)/i,  // profile-pic, profile_image, etc.
        /user[-_]?(pic|img|image|photo)/i,     // user-image, user_photo, etc.
        /author[-_]?(pic|img|image|photo)/i,   // author-image, etc.
        /\/u\/\d+/,                             // /u/12345 style paths
        /gravatar/i,
        /miro\.medium\.com.*\/1\*.*\/\d+x\d+/  // Medium avatar pattern
      ];
      if (avatarPatterns.some(p => p.test(src))) return true;
    }

    return false;
  }

  /**
   * Check if an anchor element is a link embed/bookmark card
   * Medium and other sites use these for rich link previews
   */
  function isLinkEmbed(anchor) {
    if (!anchor || anchor.tagName.toLowerCase() !== 'a') return false;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return false;

    // Check if it's a block-level link (not inline)
    const display = window.getComputedStyle ? window.getComputedStyle(anchor).display : '';
    const isBlock = display === 'block' || display === 'flex' || display === 'grid';

    // Check for card-like structure: has multiple children or specific classes
    const hasMultipleChildren = anchor.children.length > 1;
    const hasCardClass = /card|embed|bookmark|preview|link-box/i.test(anchor.className);
    const hasImage = anchor.querySelector('img, picture');
    const textLength = anchor.textContent.trim().length;

    // It's likely a link embed if:
    // - It's block-level with children, OR
    // - Has card-like classes, OR
    // - Has both image and substantial text
    return (isBlock && hasMultipleChildren) ||
           hasCardClass ||
           (hasImage && textLength > 20) ||
           (textLength > 50 && hasMultipleChildren);
  }

  /**
   * Extract link embed information from an anchor
   */
  function extractLinkEmbed(anchor, baseUrl) {
    let href = anchor.getAttribute('href') || '';

    // Resolve relative URLs
    if (href && !href.startsWith('http') && !href.startsWith('//')) {
      try {
        href = new URL(href, baseUrl).href;
      } catch (e) {
        // Keep as-is
      }
    }

    // Try to extract title - look for headings or strong text first
    let title = '';
    const headingEl = anchor.querySelector('h1, h2, h3, h4, h5, h6, strong, b');
    if (headingEl) {
      title = headingEl.textContent.trim();
    }

    // If no heading, use the first line or the link text
    if (!title) {
      const text = anchor.textContent.trim();
      const firstLine = text.split('\n')[0].trim();
      title = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
    }

    // Try to extract description
    let description = '';
    const pEl = anchor.querySelector('p, span:not(:first-child)');
    if (pEl && pEl.textContent.trim() !== title) {
      description = pEl.textContent.trim();
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }
    }

    // Get domain for display
    let domain = '';
    try {
      domain = new URL(href).hostname.replace('www.', '');
    } catch (e) {
      domain = href;
    }

    return {
      type: 'linkEmbed',
      url: href,
      title: title || domain,
      description: description,
      domain: domain
    };
  }

  function parseHTMLContent(html, baseUrl) {
    const container = document.createElement('div');
    container.innerHTML = html;

    const elements = [];
    let elementCount = 0; // Track position to help filter early metadata

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        // Filter out metadata text, especially early in the document
        if (text && !isMetadataText(text)) {
          elements.push({ type: 'text', content: text });
          elementCount++;
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      // Helper to create image element with rendered dimensions
      function createImageElement(img) {
        return {
          type: 'image',
          src: img.src,
          alt: img.alt || '',
          renderedWidth: img.renderedWidth,
          renderedHeight: img.renderedHeight
        };
      }

      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          // Check for images in heading (filter out avatars)
          const headingImages = findAllImages(node);
          headingImages.forEach(img => {
            if (!isAvatarImage(img.renderedWidth, img.renderedHeight, img.src)) {
              elements.push(createImageElement(img));
            }
          });
          const headingText = node.textContent.trim();
          if (headingText && !isMetadataText(headingText)) {
            elements.push({ type: 'heading', level: parseInt(tag[1]), content: headingText });
            elementCount++;
          }
          break;

        case 'p':
          // Extract images from paragraph first (filter out avatars)
          const pImages = findAllImages(node);
          pImages.forEach(img => {
            if (!isAvatarImage(img.renderedWidth, img.renderedHeight, img.src)) {
              elements.push(createImageElement(img));
            }
          });
          // Then add text (filter out metadata)
          const text = node.textContent.trim();
          if (text && !isMetadataText(text)) {
            elements.push({ type: 'paragraph', content: text });
            elementCount++;
          }
          break;

        case 'a':
          // Check if this is a link embed/bookmark card
          if (isLinkEmbed(node)) {
            const linkEmbed = extractLinkEmbed(node, baseUrl);
            if (linkEmbed.url && linkEmbed.title) {
              elements.push(linkEmbed);
              elementCount++;
            }
          } else {
            // Regular inline link - recurse into children
            for (const child of node.childNodes) processNode(child);
          }
          break;

        case 'pre':
          const code = node.querySelector('code');
          elements.push({ type: 'code', content: (code || node).textContent });
          break;

        case 'blockquote':
          // Extract images from blockquote first (filter avatars)
          const bqImages = findAllImages(node);
          bqImages.forEach(img => {
            if (!isAvatarImage(img.renderedWidth, img.renderedHeight, img.src)) {
              elements.push(createImageElement(img));
            }
          });
          const bqText = node.textContent.trim();
          if (bqText && !isMetadataText(bqText)) {
            elements.push({ type: 'blockquote', content: bqText });
          }
          break;

        case 'ul': case 'ol':
          const items = node.querySelectorAll(':scope > li');
          items.forEach((li, idx) => {
            // Extract images from list item first (filter avatars)
            const liImages = findAllImages(li);
            liImages.forEach(img => {
              if (!isAvatarImage(img.renderedWidth, img.renderedHeight, img.src)) {
                elements.push(createImageElement(img));
              }
            });
            const liText = li.textContent.trim();
            // Don't filter metadata from list items - they might be intentional content
            if (liText) {
              elements.push({
                type: 'listItem',
                content: liText,
                ordered: tag === 'ol',
                index: idx + 1
              });
            }
          });
          break;

        case 'img':
          const src = getImageUrl(node);
          if (src) {
            const dims = getRenderedDimensions(node);
            const imgWidth = dims ? dims.width : null;
            const imgHeight = dims ? dims.height : null;

            // Filter out avatar/profile images
            if (!isAvatarImage(imgWidth, imgHeight, src)) {
              elements.push({
                type: 'image',
                src: src,
                alt: node.getAttribute('alt') || '',
                renderedWidth: imgWidth,
                renderedHeight: imgHeight
              });
            }
          }
          break;

        case 'picture':
          // Handle picture element with sources
          const picSrc = getImageUrlFromPicture(node);
          const picImg = node.querySelector('img');
          if (picSrc) {
            const picDims = picImg ? getRenderedDimensions(picImg) : null;
            const picWidth = picDims ? picDims.width : null;
            const picHeight = picDims ? picDims.height : null;

            // Filter out avatar/profile images
            if (!isAvatarImage(picWidth, picHeight, picSrc)) {
              elements.push({
                type: 'image',
                src: picSrc,
                alt: picImg ? (picImg.getAttribute('alt') || '') : '',
                renderedWidth: picWidth,
                renderedHeight: picHeight
              });
            }
          }
          break;

        case 'figure':
          const figPicture = node.querySelector('picture');
          const figImg = node.querySelector('img');
          const figcaption = node.querySelector('figcaption');
          const figAlt = figcaption ? figcaption.textContent.trim() : '';

          if (figPicture) {
            const figPicSrc = getImageUrlFromPicture(figPicture);
            if (figPicSrc) {
              const figPicImg = figPicture.querySelector('img');
              const figDims = figPicImg ? getRenderedDimensions(figPicImg) : null;
              const figPicWidth = figDims ? figDims.width : null;
              const figPicHeight = figDims ? figDims.height : null;

              // Filter out avatar/profile images
              if (!isAvatarImage(figPicWidth, figPicHeight, figPicSrc)) {
                elements.push({
                  type: 'image',
                  src: figPicSrc,
                  alt: figAlt || (figImg ? figImg.getAttribute('alt') : '') || '',
                  renderedWidth: figPicWidth,
                  renderedHeight: figPicHeight
                });
              }
            }
          } else if (figImg) {
            const imgSrc = getImageUrl(figImg);
            if (imgSrc) {
              const figImgDims = getRenderedDimensions(figImg);
              const figImgWidth = figImgDims ? figImgDims.width : null;
              const figImgHeight = figImgDims ? figImgDims.height : null;

              // Filter out avatar/profile images
              if (!isAvatarImage(figImgWidth, figImgHeight, imgSrc)) {
                elements.push({
                  type: 'image',
                  src: imgSrc,
                  alt: figAlt || figImg.getAttribute('alt') || '',
                  renderedWidth: figImgWidth,
                  renderedHeight: figImgHeight
                });
              }
            }
          }
          break;

        case 'table':
          const tableData = parseTable(node);
          if (tableData.rows.length > 0) {
            elements.push({ type: 'table', rows: tableData.rows, cellImages: tableData.cellImages });
          }
          break;

        case 'hr':
          elements.push({ type: 'hr' });
          break;

        default:
          // Container elements - recurse into children
          // Note: 'a' is handled separately above for link embeds
          const containerTags = [
            'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav',
            'span', 'strong', 'em', 'b', 'i', 'u', 'mark', 'small', 'del', 'ins',
            'sub', 'sup', 'cite', 'q', 'abbr', 'time', 'address', 'details', 'summary'
          ];
          if (containerTags.includes(tag)) {
            // Check if this container has direct images (not in sub-containers)
            const directImages = [];
            node.childNodes.forEach(child => {
              if (child.nodeType === Node.ELEMENT_NODE) {
                const childTag = child.tagName.toLowerCase();
                if (childTag === 'img') {
                  const imgSrc = getImageUrl(child);
                  if (imgSrc) directImages.push({ src: imgSrc, alt: child.getAttribute('alt') || '' });
                } else if (childTag === 'picture') {
                  const picSrc = getImageUrlFromPicture(child);
                  const picImg = child.querySelector('img');
                  if (picSrc) directImages.push({ src: picSrc, alt: picImg ? picImg.getAttribute('alt') || '' : '' });
                }
              }
            });
            // Add direct images
            directImages.forEach(img => {
              elements.push({ type: 'image', src: img.src, alt: img.alt });
            });
            // Recurse into children
            for (const child of node.childNodes) processNode(child);
          }
          break;
      }
    }

    for (const child of container.childNodes) processNode(child);
    return elements;
  }

  // ============================================
  // Main Execution
  // ============================================

  try {
    if (typeof Readability === 'undefined') throw new Error('Readability library not loaded');
    if (typeof jspdf === 'undefined') throw new Error('jsPDF library not loaded');

    // Trigger lazy loading
    if (typeof triggerLazyLoading === 'function') {
      await triggerLazyLoading();
    }

    // Extract article
    const documentClone = document.cloneNode(true);
    const baseUrl = document.location.href;

    const reader = new Readability(documentClone, { charThreshold: 0 });
    const article = reader.parse();

    if (!article || !article.content) {
      return {
        success: false,
        error: 'Could not extract article content. This page may not have readable content.'
      };
    }

    // Create PDF
    const { jsPDF } = jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const renderer = new PDFRenderer(doc, PDF_CONFIG);

    // Render frontmatter
    const title = article.title || document.title || 'Untitled';
    renderer.renderFrontmatter(
      title,
      baseUrl,
      formatDate(new Date()),
      article.byline || '',
      article.siteName || ''
    );

    // Parse and render content
    const elements = parseHTMLContent(article.content, baseUrl);

    for (const el of elements) {
      switch (el.type) {
        case 'heading':
          renderer.renderHeading(el.content, el.level);
          break;
        case 'paragraph':
        case 'text':
          renderer.renderParagraph(el.content);
          break;
        case 'code':
          renderer.renderCodeBlock(el.content);
          break;
        case 'blockquote':
          renderer.renderBlockquote(el.content);
          break;
        case 'listItem':
          renderer.renderListItem(el.content, el.ordered, el.index);
          break;
        case 'image':
          await renderer.renderImage(el.src, el.alt, baseUrl, el.renderedWidth, el.renderedHeight);
          break;
        case 'linkEmbed':
          renderer.renderLinkEmbed(el.url, el.title, el.description, el.domain);
          break;
        case 'table':
          await renderer.renderTable(el.rows, el.cellImages || {}, baseUrl);
          break;
        case 'hr':
          renderer.renderHR();
          break;
      }
    }

    // Add headers and footers
    renderer.addHeadersFooters();

    // Output
    const pdfBase64 = doc.output('dataurlstring');
    const safeTitle = sanitizeFilename(title);

    const sizeBytes = Math.round((pdfBase64.length - 'data:application/pdf;base64,'.length) * 0.75);
    const sizeKB = Math.round(sizeBytes / 1024);

    return {
      success: true,
      pdfData: pdfBase64,
      filename: `${safeTitle}.pdf`,
      stats: {
        title: title,
        sizeKB: sizeKB,
        pageCount: doc.getNumberOfPages(),
        imagesIncluded: renderer.imageStats.success,
        imagesFailed: renderer.imageStats.failed
      }
    };

  } catch (error) {
    console.error('PDF generation error:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred during PDF generation'
    };
  }
})();
