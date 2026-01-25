# Super Webpage Scraper

<p align="center">
  <img src="icons/super-webpage-scraper-logo.png" alt="Super Webpage Scraper Logo" width="100">
</p>

A privacy-focused Chrome extension that converts web articles to Markdown, PDF, or extracts images - all processed locally in your browser. No data ever leaves your device.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-success)
![License](https://img.shields.io/badge/License-MIT-blue)
![Version](https://img.shields.io/badge/Version-1.5.0-orange)

## Features

- **Markdown Export** - Clean markdown with YAML frontmatter, bundled with images in a ZIP file
- **PDF Export** - Professional PDFs with selectable text, proper typography, code blocks, tables, and images
- **Image Extraction** - Download all article images as a ZIP archive
- **Concurrent Operations** - Run exports on multiple tabs simultaneously
- **Lazy Loading Support** - Automatically scrolls pages to capture lazy-loaded images
- **Smart Article Detection** - Identifies article content vs web apps to warn about incompatible pages
- **CDN Compatibility** - Works with modern image CDNs (Framer, Cloudinary, etc.) via smart content negotiation
- **Dark/Light Mode** - UI adapts to system color scheme
- **100% Local Processing** - All conversion happens in your browser

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/VegaStack/tools-super-webpage-scraper.git
   cd tools-super-webpage-scraper
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top right)

4. Click **Load unpacked** and select the repository folder

### Usage

1. Navigate to any article or blog post
2. Click the extension icon in your browser toolbar
3. Choose your export format:
   - **Save as Markdown** - Creates a ZIP with `.md` file and images folder
   - **Save as PDF** - Generates a formatted PDF document
   - **Save all Images** - Downloads article images as ZIP

## How It Works

### Architecture

```
tools-super-webpage-scraper/
├── manifest.json              # Extension configuration (Manifest V3)
├── background.js              # Service worker - orchestrates operations, handles CORS
├── popup.html/js/css          # Extension popup UI
├── content-script.js          # Markdown conversion logic
├── content-script-pdf.js      # PDF generation with jsPDF
├── content-script-images.js   # Image extraction logic
└── lib/
    ├── Readability.js         # Mozilla's article extractor
    ├── turndown.js            # HTML to Markdown converter
    ├── turndown-plugin-gfm.js # GitHub Flavored Markdown support
    ├── jspdf.umd.min.js       # Client-side PDF generation
    ├── jszip.min.js           # ZIP file creation
    ├── image-fetcher.js       # Shared CORS-bypassing image fetcher
    ├── lazy-scroll.js         # Lazy loading trigger utility
    └── article-detector.js    # Article vs web app detection
```

### Processing Flow

1. **Article Detection** - Analyzes page structure, schema.org markup, and Open Graph tags to determine if content is extractable
2. **Lazy Loading Trigger** - Scrolls through the page to activate lazy-loaded images
3. **Content Extraction** - Uses Mozilla Readability to extract clean article content
4. **Conversion** - Transforms content to the chosen format (Markdown/PDF)
5. **Image Processing** - Downloads and embeds images with CORS fallback strategies
6. **Format Optimization** - JPEG/PNG pass through directly; WebP/AVIF converted to JPEG for compatibility
7. **Packaging** - Creates downloadable ZIP or PDF file

### Image Fetching Strategy

The extension uses a multi-layer approach for reliable image fetching:

1. **Direct Fetch** - Attempts same-origin or CORS-enabled fetch first
2. **Background Script Bypass** - Falls back to background script with `host_permissions` for cross-origin images
3. **Smart Accept Headers** - Excludes AVIF from Accept header to ensure CDN compatibility (jsPDF doesn't support AVIF)
4. **Format-Aware Processing** - JPEG/PNG preserved as-is; WebP/AVIF converted to JPEG (85% quality) for optimal file size

### Concurrent Per-Tab Operations

The extension uses a Map-based state management system allowing simultaneous exports across different tabs:

```javascript
const operationsByTabId = new Map();  // tabId => operation state
const operationTimeouts = new Map();  // tabId => timeout handle
```

Each tab maintains independent operation state, timeouts, and keep-alive alarms.

## Output Formats

### Markdown ZIP Structure
```
article-title.zip
├── article-title.md    # Markdown with YAML frontmatter
└── images/
    ├── img1.jpg
    ├── img2.png
    └── ...
```

**Frontmatter includes:**
- Title, source URL, save date
- Author (if detected)
- Site name
- Original publish date (if available)

### PDF Features
- A4 page format with proper margins
- **Selectable text** - Copy/paste text from generated PDFs
- **Emoji support** - Full emoji rendering via canvas fallback
- Styled headings (H1-H6) with proper hierarchy
- Code blocks with monospace font and gray background
- Table formatting with borders and cell padding
- Embedded images (auto-scaled to fit page width)
- Link embed cards for bookmark-style links
- Page numbers and source URL in footer
- **Optimized file size** - Native formats preserved, minimal conversions

## Dependencies

### Runtime Libraries (bundled in `/lib`)

| Library | Version | Purpose |
|---------|---------|---------|
| [@mozilla/readability](https://github.com/mozilla/readability) | 0.6.0 | Article content extraction |
| [Turndown](https://github.com/mixmark-io/turndown) | 7.x | HTML to Markdown conversion |
| [joplin-turndown-plugin-gfm](https://github.com/laurent22/joplin-turndown-plugin-gfm) | 1.0.12 | GitHub Flavored Markdown support |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | Client-side PDF generation |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | ZIP file creation |

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Access content of the current tab |
| `scripting` | Inject content scripts for extraction |
| `downloads` | Save generated files |
| `alarms` | Keep service worker alive during long operations |
| `<all_urls>` | Fetch images from any domain (CORS bypass) |

## Browser Compatibility

- **Chrome** 88+ (Manifest V3 support required)
- **Edge** 88+ (Chromium-based)
- **Brave**, **Opera**, **Vivaldi** (Chromium-based browsers)

> **Note:** Firefox is not supported due to differences in Manifest V3 implementation.

## Limitations

- **Web Apps** - Cannot extract content from interactive applications (Gmail, Figma, etc.)
- **CORS Restrictions** - Most cross-origin images work via background script bypass, but some heavily restricted servers may fail
- **Dynamic Content** - Single-page apps with client-side routing may have extraction issues
- **Login-Required Content** - Cannot access paywalled or authenticated content
- **Very Long Articles** - PDF generation may timeout for extremely long content

## Development

### Project Setup

```bash
git clone https://github.com/VegaStack/tools-super-webpage-scraper.git
cd tools-super-webpage-scraper
npm install
```

### Testing

1. Load the extension in Chrome (developer mode)
2. Navigate to various article pages
3. Test each export format
4. Verify concurrent operations work across multiple tabs
5. Test with CDN-hosted images (Framer, Cloudinary, etc.)

## Privacy

This extension processes all content locally in your browser:

- No data is sent to external servers
- No analytics or tracking
- No account required
- Images are fetched directly from their original sources

## License

[MIT License](https://opensource.org/licenses/MIT)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

- [Mozilla Readability](https://github.com/mozilla/readability) - The core article extraction algorithm
- [Turndown](https://github.com/mixmark-io/turndown) - Excellent HTML to Markdown conversion
- [jsPDF](https://github.com/parallax/jsPDF) - Lightweight client-side PDF generation
