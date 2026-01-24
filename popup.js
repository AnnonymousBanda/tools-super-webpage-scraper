// ============================================
// Popup Script - Message Passing with Service Worker
// ============================================

// Store current tab ID for filtering status updates
let currentTabId = null;

// ============================================
// URL Validation
// ============================================

function validateUrl(url) {
  if (!url) {
    return { valid: false, error: 'No URL found.' };
  }

  const restrictedSchemes = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://', 'opera://', 'vivaldi://'];
  for (const scheme of restrictedSchemes) {
    if (url.startsWith(scheme)) {
      return { valid: false, error: 'browser' };
    }
  }

  if (url.startsWith('file://')) {
    return { valid: false, error: 'local' };
  }

  if (url.startsWith('data:')) {
    return { valid: false, error: 'data' };
  }

  if (url.startsWith('javascript:')) {
    return { valid: false, error: 'javascript' };
  }

  if (url.startsWith('view-source:')) {
    return { valid: false, error: 'view-source' };
  }

  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { valid: false, error: 'protocol' };
    }
  } catch (e) {
    return { valid: false, error: 'invalid' };
  }

  return { valid: true };
}

// ============================================
// UI State Management
// ============================================

function showLoading(message = 'Converting...') {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('loading-text').textContent = message;
  document.getElementById('error').classList.add('hidden');
  document.getElementById('success').classList.add('hidden');
  document.getElementById('save-markdown').disabled = true;
  document.getElementById('save-pdf').disabled = true;
  document.getElementById('save-images').disabled = true;
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('save-markdown').disabled = false;
  document.getElementById('save-pdf').disabled = false;
  document.getElementById('save-images').disabled = false;
}

function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  document.getElementById('success').classList.add('hidden');
  hideLoading();
}

function showSuccess(message) {
  const successEl = document.getElementById('success');
  successEl.textContent = message;
  successEl.classList.remove('hidden');
  document.getElementById('error').classList.add('hidden');
  hideLoading();

  // Auto-hide success message after 4 seconds
  setTimeout(() => {
    successEl.classList.add('hidden');
  }, 4000);
}

function clearMessages() {
  document.getElementById('error').classList.add('hidden');
  document.getElementById('success').classList.add('hidden');
}

function showUnsupported() {
  document.getElementById('unsupported').classList.remove('hidden');
  document.getElementById('save-markdown').disabled = true;
  document.getElementById('save-pdf').disabled = true;
  document.getElementById('save-images').disabled = true;
  document.getElementById('error').classList.add('hidden');
  document.getElementById('success').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
}

function hideUnsupported() {
  document.getElementById('unsupported').classList.add('hidden');
}

function showNotReaderable(reason) {
  document.getElementById('unsupported').classList.remove('hidden');
  document.getElementById('unsupported-title').textContent = 'Page May Not Be Readable';

  // Use provided reason or default message
  const message = reason || 'This page doesn\'t appear to contain article content.';
  document.getElementById('unsupported-message').textContent =
    message + ' Export may not work well for web apps, dashboards, or interactive pages.';
  document.getElementById('try-anyway').classList.remove('hidden');

  document.getElementById('save-markdown').disabled = true;
  document.getElementById('save-pdf').disabled = true;
  document.getElementById('save-images').disabled = true;
}

function enableButtons() {
  document.getElementById('save-markdown').disabled = false;
  document.getElementById('save-pdf').disabled = false;
  document.getElementById('save-images').disabled = false;
  document.getElementById('unsupported').classList.add('hidden');
}

// ============================================
// Service Worker Communication
// ============================================

// Send message to service worker with error handling
async function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Check for chrome.runtime.lastError to prevent unhandled error
        if (chrome.runtime.lastError) {
          // Service worker might not be ready, resolve with null
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      // Handle synchronous errors
      resolve(null);
    }
  });
}

// Check if the page is probably readable (has article content)
async function checkPageReadability(tabId, tabUrl) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'CHECK_READABILITY', tabId, tabUrl },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ isReaderable: true }); // Fail open
        } else {
          resolve({
            isReaderable: response.isReaderable,
            reason: response.reason,
            confidence: response.confidence
          });
        }
      }
    );
  });
}

// ============================================
// Status Update Handler
// ============================================

function handleStatusUpdate(operation) {
  if (!operation) {
    hideLoading();
    return;
  }

  const processingMessages = {
    'pdf': 'Generating PDF...',
    'images': 'Extracting images...',
    'markdown': 'Extracting content...'
  };
  const downloadingMessages = {
    'pdf': 'Downloading PDF...',
    'images': 'Downloading images...',
    'markdown': 'Downloading ZIP...'
  };
  const statusMessages = {
    'starting': 'Starting...',
    'injecting': 'Loading libraries...',
    'processing': processingMessages[operation.type] || 'Processing...',
    'downloading': downloadingMessages[operation.type] || 'Downloading...'
  };

  switch (operation.status) {
    case 'starting':
    case 'injecting':
    case 'processing':
    case 'downloading':
      showLoading(operation.message || statusMessages[operation.status]);
      break;

    case 'completed':
      showSuccess(operation.message);
      break;

    case 'error':
    case 'timeout':
      showError(operation.error || operation.message);
      break;

    default:
      hideLoading();
  }
}

// ============================================
// Message Listener
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STATUS_UPDATE') {
    // Only handle updates for the current tab
    if (message.tabId === currentTabId) {
      handleStatusUpdate(message.operation);
    }
  }
  // Return false to indicate we won't send a response asynchronously
  return false;
});

// ============================================
// Event Handlers
// ============================================

async function handleSaveMarkdown() {
  clearMessages();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showError('No active tab found. Please try again.');
      return;
    }

    showLoading('Starting...');

    const response = await sendMessageToBackground({
      type: 'START_CONVERSION',
      conversionType: 'markdown',
      tabId: tab.id,
      tabUrl: tab.url
    });

    if (response === null) {
      showError('Extension error. Please reload the extension and try again.');
      return;
    }

    if (!response.success) {
      showError(response.error || 'Failed to start conversion.');
    }
  } catch (error) {
    showError(error.message || 'Failed to start conversion.');
  }
}

async function handleSavePDF() {
  clearMessages();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showError('No active tab found. Please try again.');
      return;
    }

    showLoading('Starting...');

    const response = await sendMessageToBackground({
      type: 'START_CONVERSION',
      conversionType: 'pdf',
      tabId: tab.id,
      tabUrl: tab.url
    });

    if (response === null) {
      showError('Extension error. Please reload the extension and try again.');
      return;
    }

    if (!response.success) {
      showError(response.error || 'Failed to start conversion.');
    }
  } catch (error) {
    showError(error.message || 'Failed to start conversion.');
  }
}

async function handleSaveImages() {
  clearMessages();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showError('No active tab found. Please try again.');
      return;
    }

    showLoading('Starting...');

    const response = await sendMessageToBackground({
      type: 'START_CONVERSION',
      conversionType: 'images',
      tabId: tab.id,
      tabUrl: tab.url
    });

    if (response === null) {
      showError('Extension error. Please reload the extension and try again.');
      return;
    }

    if (!response.success) {
      showError(response.error || 'Failed to start extraction.');
    }
  } catch (error) {
    showError(error.message || 'Failed to start extraction.');
  }
}

// ============================================
// Initialization
// ============================================

async function init() {
  // Attach event listeners
  document.getElementById('save-markdown').addEventListener('click', handleSaveMarkdown);
  document.getElementById('save-pdf').addEventListener('click', handleSavePDF);
  document.getElementById('save-images').addEventListener('click', handleSaveImages);

  // "Try anyway" button listener
  document.getElementById('try-anyway').addEventListener('click', () => {
    enableButtons();
  });

  // Check current tab URL and show unsupported message if needed
  let currentTab = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (tab) {
      // Store the tab ID for filtering status updates
      currentTabId = tab.id;

      const urlCheck = validateUrl(tab.url);

      if (!urlCheck.valid) {
        showUnsupported();
        return; // Don't check for ongoing operations on unsupported pages
      }
    }
  } catch (error) {
    // If we can't get the tab, show unsupported
    showUnsupported();
    return;
  }

  // Check if page is probably readable (has article content)
  if (currentTab) {
    const detection = await checkPageReadability(currentTab.id, currentTab.url);
    if (!detection.isReaderable) {
      showNotReaderable(detection.reason);
      return;
    }
  }

  // Check for any ongoing operation when popup opens (for THIS tab only)
  const response = await sendMessageToBackground({
    type: 'GET_STATUS',
    tabId: currentTabId
  });
  if (response && response.operation) {
    handleStatusUpdate(response.operation);
  }
}

document.addEventListener('DOMContentLoaded', init);
