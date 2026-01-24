// Content script for extracting article content and generating PDF
// This runs in the page context after libraries are injected

(async function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const IMAGE_TIMEOUT = 5000; // 5 seconds per image
  const MAX_FILENAME_LENGTH = 100;

  // A4 page dimensions in points: 595.28 x 841.89
  // With margins [40, 60, 40, 60], content area is:
  const CONTENT_WIDTH = 515;  // 595.28 - 40 - 40

  // PDF document styling
  const PDF_STYLES = {
    header: { fontSize: 22, bold: true, margin: [0, 0, 0, 8], color: '#1a1a1a' },
    subheader: { fontSize: 10, color: '#666666', margin: [0, 0, 0, 15] },
    content: { fontSize: 11, lineHeight: 1.5 },
    h1: { fontSize: 18, bold: true, margin: [0, 20, 0, 10], color: '#1a1a1a' },
    h2: { fontSize: 16, bold: true, margin: [0, 18, 0, 8], color: '#1a1a1a' },
    h3: { fontSize: 14, bold: true, margin: [0, 14, 0, 6], color: '#333333' },
    h4: { fontSize: 12, bold: true, margin: [0, 12, 0, 5], color: '#333333' },
    h5: { fontSize: 11, bold: true, margin: [0, 10, 0, 4], color: '#444444' },
    h6: { fontSize: 10, bold: true, margin: [0, 8, 0, 4], color: '#444444' },
    footer: { fontSize: 9, color: '#999999', margin: [0, 20, 0, 0] },
    // Code block styling
    codeBlock: {
      fontSize: 9,
      font: 'Roboto',
      margin: [0, 8, 0, 8],
      background: '#f6f8fa',
      preserveLeadingSpaces: true,
      lineHeight: 1.3
    },
    // Inline code styling
    inlineCode: {
      fontSize: 10,
      background: '#f0f0f0',
      color: '#d63384'
    }
  };

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

  async function fetchImageAsBase64(url) {
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

        if (blob.size > 0) {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
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

  function resolveUrl(src, baseUrl) {
    if (!src) return null;
    if (src.startsWith('data:')) return src; // Keep data URLs as-is
    try {
      return new URL(src, baseUrl).href;
    } catch (e) {
      return null;
    }
  }

  // ============================================
  // pdfmake Content Post-Processing
  // ============================================

  /**
   * Recursively sanitize pdfmake content to remove invalid nodes
   * that could cause PDF generation to fail.
   *
   * @param {any} content - pdfmake content node
   * @param {WeakSet} visited - tracks visited objects to prevent infinite loops
   * @returns {any} - sanitized content or null if invalid
   */
  function sanitizePdfContent(content, visited = new WeakSet()) {
    // Null/undefined - remove
    if (content === null || content === undefined) {
      return null;
    }

    // Primitives are fine (strings, numbers, booleans)
    if (typeof content !== 'object') {
      return content;
    }

    // Prevent circular references
    if (visited.has(content)) {
      return null;
    }
    visited.add(content);

    // Handle arrays - recursively sanitize and filter out nulls
    if (Array.isArray(content)) {
      const sanitized = content
        .map(item => sanitizePdfContent(item, visited))
        .filter(item => item !== null && item !== undefined);
      return sanitized.length > 0 ? sanitized : null;
    }

    // Handle objects
    const sanitizedObj = {};
    let hasValidContent = false;

    for (const [key, value] of Object.entries(content)) {
      // Skip null/undefined values
      if (value === null || value === undefined) {
        continue;
      }

      // Skip empty strings for content properties
      if ((key === 'text' || key === 'image') && value === '') {
        continue;
      }

      // Recursively sanitize nested content
      if (key === 'stack' || key === 'ul' || key === 'ol' || key === 'columns') {
        const sanitized = sanitizePdfContent(value, visited);
        if (sanitized && Array.isArray(sanitized) && sanitized.length > 0) {
          sanitizedObj[key] = sanitized;
          hasValidContent = true;
        }
      } else if (key === 'table' && value && value.body) {
        // Sanitize table body
        const sanitizedBody = sanitizePdfContent(value.body, visited);
        if (sanitizedBody && Array.isArray(sanitizedBody) && sanitizedBody.length > 0) {
          sanitizedObj[key] = { ...value, body: sanitizedBody };
          hasValidContent = true;
        }
      } else if (key === 'text' && Array.isArray(value)) {
        // Sanitize text arrays
        const sanitized = sanitizePdfContent(value, visited);
        if (sanitized && Array.isArray(sanitized) && sanitized.length > 0) {
          sanitizedObj[key] = sanitized;
          hasValidContent = true;
        }
      } else if (key === 'image') {
        // Validate base64 image data
        if (typeof value === 'string' && value.startsWith('data:image/')) {
          sanitizedObj[key] = value;
          hasValidContent = true;
        }
      } else if (key === 'text' && typeof value === 'string' && value.trim()) {
        sanitizedObj[key] = value;
        hasValidContent = true;
      } else if (typeof value === 'object') {
        const sanitized = sanitizePdfContent(value, visited);
        if (sanitized !== null) {
          sanitizedObj[key] = sanitized;
          hasValidContent = true;
        }
      } else {
        // Copy other valid properties (numbers, booleans, non-empty strings)
        sanitizedObj[key] = value;
        hasValidContent = true;
      }
    }

    return hasValidContent ? sanitizedObj : null;
  }

  /**
   * Recursively process pdfmake content to:
   * - Constrain images within available width
   * - Fix table layouts to prevent overflow
   *
   * @param {any} content - pdfmake content node
   * @param {number} maxWidth - maximum available width for content
   * @param {WeakSet} visited - tracks visited objects to prevent infinite loops
   */
  function processContent(content, maxWidth = CONTENT_WIDTH, visited = new WeakSet()) {
    if (!content || typeof content !== 'object') {
      return;
    }

    // Prevent infinite loops from circular references
    if (visited.has(content)) {
      return;
    }
    visited.add(content);

    // Handle arrays
    if (Array.isArray(content)) {
      for (const item of content) {
        processContent(item, maxWidth, visited);
      }
      return;
    }

    // Handle image objects - constrain to available width
    if (content.image && typeof content.image === 'string') {
      // Set width to fit within available space
      // Use smaller of current width (if set) or maxWidth
      if (!content.width || content.width > maxWidth) {
        content.width = maxWidth;
      }
      // Ensure margin exists
      if (!content.margin) {
        content.margin = [0, 4, 0, 4];
      }
      return;
    }

    // Handle tables - this is critical for preventing overflow
    if (content.table) {
      const table = content.table;
      const body = table.body;

      if (body && Array.isArray(body) && body.length > 0) {
        const colCount = body[0].length || 1;

        // Calculate available width per column
        // Account for table borders and cell padding (roughly 16pt per cell: 8 left + 8 right)
        const tablePadding = colCount * 16 + (colCount + 1) * 1; // padding + borders
        const availableTableWidth = maxWidth - tablePadding;
        const cellWidth = Math.max(50, Math.floor(availableTableWidth / colCount));

        // Set table widths to auto to let pdfmake calculate
        // But we'll constrain the content inside cells
        if (!table.widths) {
          table.widths = Array(colCount).fill('*');
        }

        // Process each cell with constrained width
        for (const row of body) {
          if (Array.isArray(row)) {
            for (const cell of row) {
              processContent(cell, cellWidth, visited);
            }
          }
        }
      }

      // Ensure table doesn't overflow by setting dontBreakRows if not set
      if (content.dontBreakRows === undefined) {
        content.dontBreakRows = false;
      }

      return;
    }

    // Handle columns - distribute width among columns
    if (content.columns && Array.isArray(content.columns)) {
      const colCount = content.columns.length;
      const colGap = 10;
      const colWidth = Math.floor((maxWidth - (colCount - 1) * colGap) / colCount);

      for (const col of content.columns) {
        processContent(col, colWidth, visited);
      }
      return;
    }

    // Handle stack elements - same width as parent
    if (content.stack && Array.isArray(content.stack)) {
      for (const item of content.stack) {
        processContent(item, maxWidth, visited);
      }
      return;
    }

    // Handle ul/ol lists - account for bullet/number indent
    if (content.ul && Array.isArray(content.ul)) {
      const listIndent = 20;
      for (const item of content.ul) {
        processContent(item, maxWidth - listIndent, visited);
      }
      return;
    }
    if (content.ol && Array.isArray(content.ol)) {
      const listIndent = 20;
      for (const item of content.ol) {
        processContent(item, maxWidth - listIndent, visited);
      }
      return;
    }

    // Handle text arrays within objects
    if (content.text && Array.isArray(content.text)) {
      for (const item of content.text) {
        processContent(item, maxWidth, visited);
      }
      return;
    }
  }

  /**
   * Enhance code blocks by wrapping them in styled tables for better visual appearance.
   * Also adds borders to regular tables.
   *
   * @param {any} content - pdfmake content
   * @returns {any} - enhanced content
   */
  function enhanceCodeBlocksAndTables(content) {
    if (!content || typeof content !== 'object') {
      return content;
    }

    // Handle arrays
    if (Array.isArray(content)) {
      return content.map(item => enhanceCodeBlocksAndTables(item));
    }

    // Detect code blocks (pre elements converted by htmlToPdfmake)
    // They typically have preserveLeadingSpaces: true and specific styling
    if (content.text && content.preserveLeadingSpaces === true && !content._enhanced) {
      // This looks like a code block - wrap it in a styled table
      const codeText = typeof content.text === 'string' ? content.text :
                       Array.isArray(content.text) ? content.text.map(t =>
                         typeof t === 'string' ? t : (t.text || '')).join('') : '';

      if (codeText.includes('\n') || codeText.length > 60) {
        // Multi-line or long code - treat as code block
        return {
          _enhanced: true,
          margin: [0, 8, 0, 12],
          table: {
            widths: ['*'],
            body: [[{
              text: codeText,
              fontSize: 9,
              preserveLeadingSpaces: true,
              lineHeight: 1.35,
              margin: [10, 10, 10, 10],
              fillColor: '#f6f8fa'
            }]]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#e1e4e8',
            vLineColor: () => '#e1e4e8',
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0
          }
        };
      }
    }

    // Enhance regular tables with borders
    if (content.table && content.table.body && !content._enhanced) {
      content._enhanced = true;
      if (!content.layout) {
        content.layout = {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 1 : 0.5,
          vLineWidth: () => 0.5,
          hLineColor: (i, node) => (i === 0 || i === node.table.body.length) ? '#cccccc' : '#e0e0e0',
          vLineColor: () => '#e0e0e0',
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 4,
          paddingBottom: () => 4
        };
      }
      // Recursively enhance table content
      content.table.body = content.table.body.map(row =>
        row.map(cell => enhanceCodeBlocksAndTables(cell))
      );
      return content;
    }

    // Recursively enhance nested content
    const enhancedContent = { ...content };
    for (const key of ['stack', 'ul', 'ol', 'columns']) {
      if (Array.isArray(content[key])) {
        enhancedContent[key] = content[key].map(item => enhanceCodeBlocksAndTables(item));
      }
    }
    if (Array.isArray(content.text)) {
      enhancedContent.text = content.text.map(item =>
        typeof item === 'object' ? enhanceCodeBlocksAndTables(item) : item
      );
    }

    return enhancedContent;
  }

  // ============================================
  // Main Logic
  // ============================================

  try {
    // Validate libraries
    if (typeof Readability === 'undefined') {
      throw new Error('Readability library not loaded');
    }
    if (typeof pdfMake === 'undefined') {
      throw new Error('pdfMake library not loaded');
    }
    if (typeof htmlToPdfmake === 'undefined') {
      throw new Error('htmlToPdfmake library not loaded');
    }

    // Scroll through page to trigger lazy-loaded images
    if (typeof triggerLazyLoading === 'function') {
      await triggerLazyLoading();
    }

    const baseUrl = document.location.href;
    const documentClone = document.cloneNode(true);

    // Extract article using Readability
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

    // Process images - convert to base64
    const container = document.createElement('div');
    container.innerHTML = article.content;
    const images = container.querySelectorAll('img');
    let imagesProcessed = 0;
    let imagesFailed = 0;

    for (const img of images) {
      // Get the image source using enhanced extraction (handles lazy loading)
      const src = getImageUrl(img);
      const resolvedUrl = resolveUrl(src, baseUrl);
      if (!resolvedUrl) {
        img.remove();
        continue;
      }

      // Skip data URLs - they're already inline
      if (resolvedUrl.startsWith('data:')) {
        imagesProcessed++;
        continue;
      }

      try {
        const base64 = await fetchImageAsBase64(resolvedUrl);
        img.setAttribute('src', base64);
        // Remove other attributes that might confuse the converter
        img.removeAttribute('data-src');
        img.removeAttribute('data-lazy-src');
        img.removeAttribute('data-original');
        img.removeAttribute('srcset');
        // Remove width/height attributes to let pdfmake handle sizing
        img.removeAttribute('width');
        img.removeAttribute('height');
        img.removeAttribute('style');
        imagesProcessed++;
      } catch (error) {
        // Remove failed images to avoid broken image icons
        img.remove();
        imagesFailed++;
        console.warn(`Failed to download image: ${resolvedUrl}`, error.message);
      }
    }

    // Build metadata
    const title = article.title || document.title || 'Untitled';
    const author = article.byline || '';
    const siteName = article.siteName || new URL(baseUrl).hostname;
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Sanitize HTML before PDF conversion - remove problematic elements
    const problematicElements = container.querySelectorAll(
      'script, style, iframe, object, embed, svg, canvas, video, audio, ' +
      'button, input, select, textarea, form, [contenteditable], ' +
      'noscript, template, slot, nav, aside, header, footer'
    );
    problematicElements.forEach(el => el.remove());

    // Convert tabs/navigation elements that might cause issues
    const tabElements = container.querySelectorAll('[role="tablist"], [role="tabpanel"], .tabs, .tab-content');
    tabElements.forEach(el => {
      // Keep the content but remove the tab wrapper structure
      if (el.getAttribute('role') === 'tabpanel' || el.classList.contains('tab-content')) {
        // These are content containers, keep them
      } else {
        // Tab lists/buttons - remove
        el.remove();
      }
    });

    // Handle details/summary elements (common in documentation)
    const detailsElements = container.querySelectorAll('details');
    detailsElements.forEach(details => {
      // Get summary and content
      const summary = details.querySelector('summary');
      const summaryText = summary ? summary.textContent : '';

      // Create a div with summary as heading
      const replacement = document.createElement('div');
      if (summaryText) {
        const heading = document.createElement('strong');
        heading.textContent = summaryText;
        replacement.appendChild(heading);
      }

      // Add remaining content
      Array.from(details.children).forEach(child => {
        if (child.tagName !== 'SUMMARY') {
          replacement.appendChild(child.cloneNode(true));
        }
      });

      details.replaceWith(replacement);
    });

    // Handle figure/figcaption elements
    const figures = container.querySelectorAll('figure');
    figures.forEach(figure => {
      const figcaption = figure.querySelector('figcaption');
      if (figcaption) {
        // Move figcaption content after the figure content as italic text
        const caption = document.createElement('p');
        caption.innerHTML = `<em>${figcaption.innerHTML}</em>`;
        figcaption.remove();
        figure.appendChild(caption);
      }
      // Replace figure with a div to avoid potential issues
      const div = document.createElement('div');
      div.innerHTML = figure.innerHTML;
      figure.replaceWith(div);
    });

    // Handle definition lists (dl, dt, dd) - convert to paragraphs
    const defLists = container.querySelectorAll('dl');
    defLists.forEach(dl => {
      const div = document.createElement('div');
      Array.from(dl.children).forEach(child => {
        if (child.tagName === 'DT') {
          const strong = document.createElement('p');
          strong.innerHTML = `<strong>${child.innerHTML}</strong>`;
          div.appendChild(strong);
        } else if (child.tagName === 'DD') {
          const p = document.createElement('p');
          p.innerHTML = child.innerHTML;
          p.style.marginLeft = '20px';
          div.appendChild(p);
        }
      });
      dl.replaceWith(div);
    });

    // Simplify code blocks - ensure they have proper structure
    const codeBlocks = container.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
      // Get text content and preserve it
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      // Limit code block length to prevent very long blocks
      const maxCodeLength = 3000;
      const truncatedText = text.length > maxCodeLength
        ? text.substring(0, maxCodeLength) + '\n\n[Code truncated...]'
        : text;
      // Replace with simple pre containing text
      pre.innerHTML = '';
      pre.textContent = truncatedText;
      // Add a class for styling reference
      pre.setAttribute('data-code-block', 'true');
    });

    // Handle inline code elements (not inside pre)
    const inlineCodes = container.querySelectorAll('code:not(pre code)');
    inlineCodes.forEach(code => {
      // Ensure inline code is properly marked
      code.setAttribute('data-inline-code', 'true');
    });

    // Remove empty paragraphs and divs
    const emptyElements = container.querySelectorAll('p:empty, div:empty, span:empty');
    emptyElements.forEach(el => el.remove());

    // Clean up excessive whitespace in text nodes
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }
    textNodes.forEach(node => {
      // Don't modify whitespace in pre/code elements
      if (node.parentElement &&
          (node.parentElement.tagName === 'PRE' || node.parentElement.tagName === 'CODE')) {
        return;
      }
      // Collapse multiple spaces/newlines to single space
      if (node.textContent) {
        node.textContent = node.textContent.replace(/\s+/g, ' ');
      }
    });

    // Convert HTML to pdfmake format with error handling
    let convertedContent;
    try {
      convertedContent = htmlToPdfmake(container.innerHTML, {
        defaultStyles: {
          // Paragraphs
          p: { margin: [0, 0, 0, 10], lineHeight: 1.4 },
          // Images
          img: { margin: [0, 10, 0, 10] },
          // Tables
          table: { margin: [0, 10, 0, 10] },
          th: { bold: true, fillColor: '#f0f0f0', margin: [5, 5, 5, 5] },
          td: { margin: [5, 4, 5, 4] },
          // Lists
          ul: { margin: [0, 4, 0, 10] },
          ol: { margin: [0, 4, 0, 10] },
          li: { margin: [0, 3, 0, 3], lineHeight: 1.3 },
          // Blockquotes
          blockquote: {
            margin: [15, 10, 15, 10],
            italics: true,
            color: '#555555',
            background: '#f9f9f9'
          },
          // Code - inline
          code: {
            fontSize: 9,
            background: '#f0f0f0',
            color: '#c7254e',
            preserveLeadingSpaces: true
          },
          // Code blocks
          pre: {
            fontSize: 9,
            margin: [0, 10, 0, 12],
            background: '#f6f8fa',
            preserveLeadingSpaces: true,
            lineHeight: 1.35
          },
          // Links
          a: { color: '#0969da', decoration: 'underline' },
          // Headings (these supplement PDF_STYLES)
          h1: { fontSize: 18, bold: true, margin: [0, 20, 0, 10], color: '#1a1a1a' },
          h2: { fontSize: 16, bold: true, margin: [0, 18, 0, 8], color: '#1a1a1a' },
          h3: { fontSize: 14, bold: true, margin: [0, 14, 0, 6], color: '#333333' },
          h4: { fontSize: 12, bold: true, margin: [0, 12, 0, 5], color: '#333333' },
          h5: { fontSize: 11, bold: true, margin: [0, 10, 0, 4], color: '#444444' },
          h6: { fontSize: 10, bold: true, margin: [0, 8, 0, 4], color: '#444444' },
          // Strong/Bold
          b: { bold: true },
          strong: { bold: true },
          // Emphasis
          i: { italics: true },
          em: { italics: true }
        },
        imagesByReference: false
      });
    } catch (htmlError) {
      throw new Error(`HTML conversion failed: ${htmlError.message}`);
    }

    // Validate converted content
    if (!convertedContent || (Array.isArray(convertedContent) && convertedContent.length === 0)) {
      throw new Error('HTML to PDF conversion produced empty content');
    }

    // Sanitize content to remove invalid nodes that could cause PDF generation to fail
    try {
      convertedContent = sanitizePdfContent(convertedContent);
      if (!convertedContent || (Array.isArray(convertedContent) && convertedContent.length === 0)) {
        throw new Error('Content sanitization produced empty result');
      }
    } catch (sanitizeError) {
      console.warn('Content sanitization warning:', sanitizeError.message);
      // Try to continue with original content
    }

    // Post-process content to constrain images and fix table layouts
    try {
      processContent(convertedContent, CONTENT_WIDTH);
    } catch (processError) {
      console.warn('Content post-processing warning:', processError.message);
      // Continue anyway - this is not fatal
    }

    // Enhance code blocks and tables with better styling
    try {
      convertedContent = enhanceCodeBlocksAndTables(convertedContent);
    } catch (enhanceError) {
      console.warn('Content enhancement warning:', enhanceError.message);
      // Continue with original content
    }

    // Build document definition
    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      content: [
        { text: title, style: 'header' },
        {
          text: [
            author ? `By ${author} | ` : '',
            `${siteName}\n`,
            `Saved on ${date}`
          ],
          style: 'subheader'
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 0,
              x2: CONTENT_WIDTH,
              y2: 0,
              lineWidth: 0.5,
              lineColor: '#e0e0e0'
            }
          ]
        },
        { text: '', margin: [0, 10, 0, 0] },
        convertedContent
      ],
      footer: function(currentPage, pageCount) {
        return {
          columns: [
            {
              text: `Source: ${baseUrl}`,
              fontSize: 8,
              color: '#999999',
              margin: [40, 0, 0, 0],
              width: 'auto'
            },
            {
              text: `Page ${currentPage} of ${pageCount}`,
              fontSize: 8,
              color: '#999999',
              alignment: 'right',
              margin: [0, 0, 40, 0]
            }
          ]
        };
      },
      styles: PDF_STYLES,
      defaultStyle: {
        font: 'Roboto',
        fontSize: 11,
        lineHeight: 1.5,
        color: '#24292f'
      },
      // Better page break handling
      pageBreakBefore: function(currentNode) {
        // Avoid breaking inside code blocks or right after headings
        return false;
      }
    };

    // Generate PDF with timeout and proper error handling
    const PDF_TIMEOUT = 30000; // 30 seconds
    let pdfBlob;

    try {
      pdfBlob = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('PDF generation timed out after 30 seconds'));
        }, PDF_TIMEOUT);

        try {
          const pdfDoc = pdfMake.createPdf(docDefinition);

          // getBlob only takes a callback, no error callback
          pdfDoc.getBlob((blob) => {
            clearTimeout(timeoutId);
            if (blob && blob.size > 0) {
              resolve(blob);
            } else {
              reject(new Error('PDF generation returned empty blob'));
            }
          });
        } catch (err) {
          clearTimeout(timeoutId);
          reject(new Error(`PDF creation failed: ${err.message}`));
        }
      });
    } catch (pdfError) {
      // If PDF generation fails, try with simplified content
      console.warn('PDF generation failed, trying simplified version:', pdfError.message);

      // Create a simplified document with just text
      const simplifiedContent = [];
      const textContent = container.innerText || container.textContent || '';

      if (textContent.trim()) {
        // Split into paragraphs and add to content
        const paragraphs = textContent.split(/\n\n+/).filter(p => p.trim());
        for (const para of paragraphs) {
          simplifiedContent.push({ text: para.trim(), margin: [0, 0, 0, 8] });
        }
      }

      if (simplifiedContent.length === 0) {
        throw new Error(`PDF generation failed: ${pdfError.message}`);
      }

      const simplifiedDocDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 60, 40, 60],
        content: [
          { text: title, style: 'header' },
          {
            text: [
              author ? `By ${author} | ` : '',
              `${siteName}\n`,
              `Saved on ${date}`
            ],
            style: 'subheader'
          },
          { text: '', margin: [0, 10, 0, 0] },
          ...simplifiedContent
        ],
        styles: PDF_STYLES,
        defaultStyle: {
          font: 'Roboto',
          fontSize: 11,
          lineHeight: 1.4
        }
      };

      pdfBlob = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Simplified PDF generation timed out'));
        }, PDF_TIMEOUT);

        try {
          pdfMake.createPdf(simplifiedDocDefinition).getBlob((blob) => {
            clearTimeout(timeoutId);
            if (blob && blob.size > 0) {
              resolve(blob);
            } else {
              reject(new Error('Simplified PDF generation returned empty blob'));
            }
          });
        } catch (err) {
          clearTimeout(timeoutId);
          reject(err);
        }
      });
    }

    // Convert blob to base64 for transfer
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });

    return {
      success: true,
      pdfData: base64Data,
      filename: `${sanitizeFilename(title)}.pdf`,
      stats: {
        title: title,
        imagesProcessed: imagesProcessed,
        imagesFailed: imagesFailed,
        sizeKB: Math.round(pdfBlob.size / 1024)
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'PDF generation failed'
    };
  }
})();
