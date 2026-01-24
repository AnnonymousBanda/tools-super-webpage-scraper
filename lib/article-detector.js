/**
 * Article Detection Library
 *
 * Uses multiple signals to determine if a page is likely an article/content page
 * vs a web app, dashboard, or interactive application.
 *
 * Returns a score-based assessment rather than simple boolean.
 */

(function() {
  'use strict';

  // Known web app hostnames that are never articles
  const APP_HOSTNAMES = [
    // Chat & Communication
    'claude.ai',
    'chat.openai.com',
    'chatgpt.com',
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'slack.com',
    'discord.com',
    'teams.microsoft.com',
    'web.whatsapp.com',
    'web.telegram.org',
    'messenger.com',

    // Productivity & Docs
    'docs.google.com',
    'sheets.google.com',
    'slides.google.com',
    'drive.google.com',
    'calendar.google.com',
    'notion.so',
    'www.notion.so',
    'airtable.com',
    'trello.com',
    'asana.com',
    'monday.com',
    'clickup.com',
    'linear.app',
    'coda.io',

    // Design & Creative
    'figma.com',
    'www.figma.com',
    'canva.com',
    'www.canva.com',
    'miro.com',
    'sketch.cloud',

    // Development
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'codepen.io',
    'codesandbox.io',
    'replit.com',
    'stackblitz.com',
    'vercel.com',
    'netlify.app',

    // Social (feeds, not articles)
    'twitter.com',
    'x.com',
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'tiktok.com',
    'reddit.com',

    // Video & Media
    'youtube.com',
    'www.youtube.com',
    'netflix.com',
    'spotify.com',
    'soundcloud.com',

    // Finance & Dashboards
    'app.stripe.com',
    'dashboard.stripe.com',
    'console.aws.amazon.com',
    'console.cloud.google.com',
    'portal.azure.com',
    'analytics.google.com',
  ];

  // URL patterns that suggest article content (override hostname blocklist)
  const ARTICLE_URL_PATTERNS = [
    /\/blog\//i,
    /\/article\//i,
    /\/articles\//i,
    /\/news\//i,
    /\/post\//i,
    /\/posts\//i,
    /\/story\//i,
    /\/stories\//i,
    /\/pulse\//i,           // LinkedIn articles
    /\/newsletters\//i,     // LinkedIn newsletters
    /\/\d{4}\/\d{2}\//, // Date pattern: /2024/01/
    /\/\d{4}\/\d{2}\/\d{2}\//, // Full date: /2024/01/15/
    /\/p\/[a-zA-Z0-9-]+/, // Medium-style: /p/article-slug
    /\/wiki\//i,
    /\/docs\//i,
    /\/documentation\//i,
    /\/guide\//i,
    /\/tutorial\//i,
    /\/how-to\//i,
  ];

  // Schema.org types that indicate article content
  const ARTICLE_SCHEMA_TYPES = [
    'Article',
    'NewsArticle',
    'BlogPosting',
    'TechArticle',
    'ScholarlyArticle',
    'Report',
    'WebPage', // Generic but still content
  ];

  /**
   * Check if hostname matches known web apps
   */
  function isKnownAppHostname(hostname) {
    const normalizedHost = hostname.toLowerCase().replace(/^www\./, '');
    return APP_HOSTNAMES.some(app => {
      const normalizedApp = app.replace(/^www\./, '');
      return normalizedHost === normalizedApp || normalizedHost.endsWith('.' + normalizedApp);
    });
  }

  /**
   * Check URL patterns for article indicators
   */
  function hasArticleUrlPattern(url) {
    return ARTICLE_URL_PATTERNS.some(pattern => pattern.test(url));
  }

  /**
   * Check for JSON-LD schema markup indicating article
   */
  function getSchemaScore(doc) {
    let score = 0;
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        const types = Array.isArray(data) ? data : [data];

        types.forEach(item => {
          const type = item['@type'];
          if (type && ARTICLE_SCHEMA_TYPES.some(t =>
            type === t || (Array.isArray(type) && type.includes(t))
          )) {
            score += 30;
          }
        });
      } catch (e) {
        // Invalid JSON, ignore
      }
    });

    return Math.min(score, 30); // Cap at 30
  }

  /**
   * Check Open Graph meta tags
   */
  function getOpenGraphScore(doc) {
    let score = 0;

    // og:type="article" is strong signal
    const ogType = doc.querySelector('meta[property="og:type"]');
    if (ogType && ogType.content === 'article') {
      score += 25;
    }

    // Having og:title and og:description suggests content page
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    const ogDesc = doc.querySelector('meta[property="og:description"]');
    if (ogTitle && ogDesc) {
      score += 5;
    }

    // article:published_time is very strong signal
    const pubTime = doc.querySelector('meta[property="article:published_time"]');
    if (pubTime) {
      score += 20;
    }

    // article:author
    const author = doc.querySelector('meta[property="article:author"]');
    if (author) {
      score += 10;
    }

    return score;
  }

  /**
   * Check semantic HTML structure
   */
  function getSemanticScore(doc) {
    let score = 0;

    // <article> tag with substantial content
    const articles = doc.querySelectorAll('article');
    articles.forEach(article => {
      const textLength = article.textContent.trim().length;
      if (textLength > 500) {
        score += 20;
      } else if (textLength > 200) {
        score += 10;
      }
    });

    // <main> tag with content
    const main = doc.querySelector('main');
    if (main && main.textContent.trim().length > 300) {
      score += 10;
    }

    // Proper heading hierarchy (h1 followed by content)
    const h1 = doc.querySelector('h1');
    if (h1) {
      const h1Text = h1.textContent.trim();
      if (h1Text.length > 10 && h1Text.length < 200) {
        score += 10;
      }
    }

    return Math.min(score, 30); // Cap at 30
  }

  /**
   * Check for web app indicators (negative signals)
   */
  function getAppSignalsPenalty(doc) {
    let penalty = 0;

    // role="application" is explicit app declaration
    if (doc.querySelector('[role="application"]')) {
      penalty += 40;
    }

    // Heavy contenteditable usage (editors, chat inputs)
    const editables = doc.querySelectorAll('[contenteditable="true"]');
    if (editables.length > 2) {
      penalty += 20;
    }

    // Many input/textarea elements suggest app
    const inputs = doc.querySelectorAll('input, textarea, select');
    if (inputs.length > 10) {
      penalty += 15;
    }

    // Chat/messaging patterns
    const chatIndicators = doc.querySelectorAll(
      '[class*="message-list"], [class*="chat-"], [class*="conversation"], ' +
      '[data-message], [class*="msg-list"], [role="log"]'
    );
    if (chatIndicators.length > 0) {
      penalty += 30;
    }

    // Dashboard/app layout patterns
    const dashboardIndicators = doc.querySelectorAll(
      '[class*="dashboard"], [class*="sidebar"][class*="nav"], ' +
      '[class*="app-container"], [class*="workspace"]'
    );
    if (dashboardIndicators.length > 0) {
      penalty += 15;
    }

    // Canvas elements (design tools, games, charts)
    const canvases = doc.querySelectorAll('canvas');
    if (canvases.length > 2) {
      penalty += 20;
    }

    // iframes (embedded apps, widgets)
    const iframes = doc.querySelectorAll('iframe');
    if (iframes.length > 3) {
      penalty += 10;
    }

    return penalty;
  }

  /**
   * Main detection function
   * Returns: { isArticle: boolean, confidence: number, signals: object }
   */
  function detectArticle(doc, url) {
    const signals = {
      hostname: { score: 0, reason: '' },
      urlPattern: { score: 0, reason: '' },
      schema: { score: 0, reason: '' },
      openGraph: { score: 0, reason: '' },
      semantic: { score: 0, reason: '' },
      appSignals: { penalty: 0, reason: '' },
    };

    let totalScore = 0;

    // 1. Check URL patterns FIRST (can override hostname blocklist)
    // URL patterns like /blog/, /article/ are strong signals - the site itself says it's an article
    const hasArticleUrl = hasArticleUrlPattern(url);
    if (hasArticleUrl) {
      signals.urlPattern = { score: 25, reason: 'URL contains article pattern.' };
      totalScore += 25;
    }

    // 2. Check hostname (but allow if URL matches article patterns)
    try {
      const hostname = new URL(url).hostname;
      if (isKnownAppHostname(hostname) && !hasArticleUrl) {
        // Only block if hostname is app-like AND URL doesn't match article patterns
        signals.hostname = { score: -100, reason: 'Known web app hostname.' };
        return {
          isArticle: false,
          confidence: 95,
          reason: 'This seems to be an interactive webapp.',
          signals
        };
      } else if (isKnownAppHostname(hostname) && hasArticleUrl) {
        // Mixed-use domain with article URL - continue checking but note it
        signals.hostname = { score: 0, reason: 'Mixed-use domain, but URL suggests article.' };
      }
    } catch (e) {
      // Invalid URL, continue with other checks
    }

    // 3. Schema.org markup
    const schemaScore = getSchemaScore(doc);
    if (schemaScore > 0) {
      signals.schema = { score: schemaScore, reason: 'Has article schema markup.' };
      totalScore += schemaScore;
    }

    // 4. Open Graph tags
    const ogScore = getOpenGraphScore(doc);
    if (ogScore > 0) {
      signals.openGraph = { score: ogScore, reason: 'Has article Open Graph tags.' };
      totalScore += ogScore;
    }

    // 5. Semantic HTML
    const semanticScore = getSemanticScore(doc);
    if (semanticScore > 0) {
      signals.semantic = { score: semanticScore, reason: 'Has article semantic structure.' };
      totalScore += semanticScore;
    }

    // 6. App signals (penalties)
    const appPenalty = getAppSignalsPenalty(doc);
    if (appPenalty > 0) {
      signals.appSignals = { penalty: appPenalty, reason: 'Has web app indicators.' };
      totalScore -= appPenalty;
    }

    // Calculate confidence
    const maxPossibleScore = 100; // URL(15) + Schema(30) + OG(60) + Semantic(30) - penalties
    const normalizedScore = Math.max(0, Math.min(100, totalScore));

    // Threshold: score >= 20 is considered an article
    const isArticle = totalScore >= 20;

    // Confidence is how sure we are about the classification
    let confidence;
    if (totalScore >= 50) {
      confidence = 90;
    } else if (totalScore >= 30) {
      confidence = 75;
    } else if (totalScore >= 20) {
      confidence = 60;
    } else if (totalScore >= 0) {
      confidence = 50;
    } else {
      confidence = 70; // Negative score = confident it's NOT an article
    }

    let reason;
    if (isArticle) {
      reason = 'Page appears to contain article content.';
    } else if (appPenalty > 30) {
      reason = 'Page appears to be a web application.';
    } else {
      reason = 'Page does not appear to contain article content.';
    }

    return {
      isArticle,
      confidence,
      score: totalScore,
      reason,
      signals
    };
  }

  // Export for use in Chrome extension
  window.detectArticle = detectArticle;

})();
