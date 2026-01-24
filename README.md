# Super Webpage Scraper

A privacy-focused Chrome extension that converts web articles to Markdown, PDF, or extracts images - all processed locally in your browser. No data ever leaves your device.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-success)
![License](https://img.shields.io/badge/License-MIT-blue)
![Version](https://img.shields.io/badge/Version-1.3.0-orange)

## Features

- **Markdown Export** - Clean markdown with YAML frontmatter, bundled with images in a ZIP file
- **PDF Export** - Professional PDFs with proper typography, code blocks, tables, and images
- **Image Extraction** - Download all article images as a ZIP archive
- **Concurrent Operations** - Run exports on multiple tabs simultaneously
- **Lazy Loading Support** - Automatically scrolls pages to capture lazy-loaded images
- **Smart Article Detection** - Identifies article content vs web apps to warn about incompatible pages
- **Dark/Light Mode** - UI adapts to system color scheme
- **100% Local Processing** - All conversion happens in your browser

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/tools-webpages-scraper.git
   cd tools-webpages-scraper
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top right)

4. Click **Load unpacked** and select the `chrome-extension` folder

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
chrome-extension/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker - orchestrates operations
├── popup.html/js/css      # Extension popup UI
├── content-script.js      # Markdown conversion logic
├── content-script-pdf.js  # PDF generation logic
├── content-script-images.js # Image extraction logic
└── lib/
    ├── Readability.js     # Mozilla's article extractor
    ├── turndown.js        # HTML to Markdown converter
    ├── pdfmake.min.js     # PDF generation library
    ├── jszip.min.js       # ZIP file creation
    ├── lazy-scroll.js     # Lazy loading trigger utility
    └── article-detector.js # Article vs web app detection
```

### Processing Flow

1. **Article Detection** - Analyzes page structure, schema.org markup, and Open Graph tags to determine if content is extractable
2. **Lazy Loading Trigger** - Scrolls through the page to activate lazy-loaded images
3. **Content Extraction** - Uses Mozilla Readability to extract clean article content
4. **Conversion** - Transforms content to the chosen format (Markdown/PDF)
5. **Image Processing** - Downloads and embeds images with CORS fallback strategies
6. **Packaging** - Creates downloadable ZIP or PDF file

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
- Styled headings (H1-H6)
- Code blocks with syntax highlighting background
- Table formatting with borders
- Embedded images (auto-scaled to fit)
- Page numbers and source URL in footer

## Dependencies

### Runtime Libraries (bundled in `/lib`)

| Library | Version | Purpose |
|---------|---------|---------|
| [@mozilla/readability](https://github.com/mozilla/readability) | 0.6.0 | Article content extraction |
| [Turndown](https://github.com/mixmark-io/turndown) | - | HTML to Markdown conversion |
| [Turndown GFM Plugin](https://github.com/mixmark-io/turndown-plugin-gfm) | - | GitHub Flavored Markdown support |
| [pdfMake](https://pdfmake.github.io/docs/) | - | Client-side PDF generation |
| [html-to-pdfmake](https://github.com/Aymkdn/html-to-pdfmake) | - | HTML to pdfMake conversion |
| [JSZip](https://stuk.github.io/jszip/) | - | ZIP file creation |

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Access content of the current tab |
| `scripting` | Inject content scripts for extraction |
| `downloads` | Save generated files |
| `alarms` | Keep service worker alive during long operations |
| `<all_urls>` | Fetch images from any domain |

## Browser Compatibility

- **Chrome** 88+ (Manifest V3 support required)
- **Edge** 88+ (Chromium-based)
- **Brave**, **Opera**, **Vivaldi** (Chromium-based browsers)

> **Note:** Firefox is not supported due to differences in Manifest V3 implementation.

## Limitations

- **Web Apps** - Cannot extract content from interactive applications (Gmail, Figma, etc.)
- **CORS Restrictions** - Some images may fail to download due to server restrictions
- **Dynamic Content** - Single-page apps with client-side routing may have extraction issues
- **Login-Required Content** - Cannot access paywalled or authenticated content
- **Very Long Articles** - PDF generation may timeout for extremely long content

## Development

### Project Setup

```bash
cd chrome-extension
npm install
```

### Testing

1. Load the extension in Chrome (developer mode)
2. Navigate to various article pages
3. Test each export format
4. Verify concurrent operations work across multiple tabs

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
- [pdfMake](https://pdfmake.github.io/docs/) - Client-side PDF generation made easy
