# Changelog

All notable changes to the Super Webpage Scraper extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2025-01-26

### Changed
- **Replaced pdfMake with jsPDF** - Switched PDF generation library for better performance and smaller bundle size
  - PDFs now have selectable text (native text rendering)
  - Full emoji support via canvas fallback
  - Smaller library footprint (~366KB vs ~500KB+ for pdfMake + fonts)
- **Optimized PDF file sizes** - Images are no longer unnecessarily converted
  - JPEG and PNG images pass through directly without re-encoding
  - Only WebP/AVIF images are converted to JPEG at 85% quality
  - Significant reduction in output PDF file sizes
- **Improved image fetching** - New shared `image-fetcher.js` library
  - CORS bypass via background script with `host_permissions`
  - Smart Accept headers exclude AVIF (which jsPDF doesn't support)
  - CDNs like Framer now serve compatible formats via content negotiation

### Fixed
- **Fixed Framer CDN images not appearing in PDFs** - The avatar detection regex `/user.*image/i` incorrectly matched `framerusercontent.com/images/` URLs, filtering out all Framer-hosted images regardless of size
  - Updated to use specific patterns: `/user[-_]?(pic|img|image|photo)/i`
  - Images from Framer and similar CDNs now render correctly in PDFs

### Added
- **Shared image fetcher library** (`lib/image-fetcher.js`) - Centralized image fetching logic used by all export features
- **Format-aware image processing** - Detects image content type and only converts when necessary

### Removed
- **Removed pdfMake libraries** - `pdfmake.min.js`, `html-to-pdfmake.js`, `vfs_fonts.js` no longer needed

## [1.4.0] - 2025-01-25

### Changed
- **Updated pdfmake** from 0.2.23 to 0.3.3 - Smaller bundle size, improved performance
- **Updated turndown-plugin-gfm** to joplin-turndown-plugin-gfm 1.0.12 - Actively maintained fork with better table handling
- **Refactored background.js** - Extracted common error handling, success handling, and library injection into reusable helper functions (~40% code reduction in conversion functions)
- **Refactored popup.js** - Consolidated three nearly identical handler functions into a single generic handler

### Fixed
- Fixed deprecated `chrome.extension.getViews()` API usage in background.js (Manifest V3 compatibility)
- Added `vivaldi://` to restricted URL schemes for consistency with popup.js
- Added try-catch error handling for URL parsing in PDF generation to prevent crashes on malformed URLs
- Fixed package.json metadata - removed reference to non-existent config.js, added proper description and keywords
- Fixed incorrect repository URLs and folder paths in README.md
- Fixed unusual nested try-catch pattern in extractImages function

### Added
- Added `.gitignore` file for cleaner repository
- Added `CHANGELOG.md` to track version history
- Improved error messages throughout the extension for better user experience
- Added centralized error message mapping for consistent, actionable error messages

## [1.3.0] - 2025-01-24

### Added
- Initial public release
- Markdown export with YAML frontmatter and bundled images
- PDF export with styled headings, code blocks, tables, and images
- Image extraction as ZIP archive
- Concurrent per-tab operation support
- Lazy loading image detection and scrolling
- Smart article detection vs web apps
- Dark/Light mode UI support

### Features
- 100% local processing - no data leaves your device
- Mozilla Readability for article extraction
- Turndown for HTML to Markdown conversion
- pdfMake for client-side PDF generation
- JSZip for archive creation

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 1.5.0 | 2025-01-26 | jsPDF migration, PDF size optimization, Framer CDN fix, shared image fetcher |
| 1.4.0 | 2025-01-25 | Library updates, code refactoring, bug fixes, improved error handling |
| 1.3.0 | 2025-01-24 | Initial public release |
