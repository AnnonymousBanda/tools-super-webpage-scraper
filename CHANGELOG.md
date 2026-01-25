# Changelog

All notable changes to the Super Webpage Scraper extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
| 1.4.0 | 2025-01-25 | Library updates, code refactoring, bug fixes, improved error handling |
| 1.3.0 | 2025-01-24 | Initial public release |
