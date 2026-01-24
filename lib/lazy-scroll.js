/**
 * Lazy Loading Scroll Utility
 *
 * Scrolls through the page to trigger lazy-loaded images before extraction.
 * Modern websites use IntersectionObserver for lazy loading, which only
 * triggers when elements enter the viewport.
 *
 * This utility is shared across all content scripts (markdown, PDF, images).
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    scrollStep: Math.floor(window.innerHeight * 0.8), // Scroll 80% of viewport
    scrollDelay: 150,       // ms to wait after each scroll
    loadWaitTime: 300,      // ms to wait for lazy load triggers
    maxScrollTime: 15000,   // Maximum total time (15 seconds)
    maxScrolls: 50,         // Maximum scroll iterations
    imageLoadTimeout: 1000, // Max wait per image (1 second)
    finalWait: 500,         // Final wait after scrolling
    returnToTop: true       // Return to original position when done
  };

  /**
   * Wait for specified milliseconds
   */
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Count fully loaded images on the page
   */
  function countLoadedImages() {
    return Array.from(document.querySelectorAll('img')).filter(img =>
      img.complete &&
      img.naturalWidth > 0 &&
      img.src &&
      !img.src.startsWith('data:image/svg')
    ).length;
  }

  /**
   * Get all images that might still need to load
   */
  function getPendingImages() {
    return Array.from(document.querySelectorAll('img')).filter(img => {
      // Has lazy loading attributes
      const hasLazyAttr = img.hasAttribute('data-src') ||
                          img.hasAttribute('data-lazy-src') ||
                          img.hasAttribute('data-original') ||
                          img.hasAttribute('loading') ||
                          img.getAttribute('loading') === 'lazy';

      // Image not yet loaded
      const notLoaded = !img.complete || img.naturalWidth === 0;

      // Has src but still loading
      const stillLoading = img.src && !img.complete;

      return hasLazyAttr || notLoaded || stillLoading;
    });
  }

  /**
   * Get images currently visible in the viewport
   */
  function getVisibleImages() {
    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;

    return Array.from(document.querySelectorAll('img')).filter(img => {
      const rect = img.getBoundingClientRect();
      const imgTop = rect.top + window.scrollY;
      const imgBottom = imgTop + rect.height;
      // Image is at least partially in viewport
      return imgBottom > viewportTop && imgTop < viewportBottom;
    });
  }

  /**
   * Scroll to a specific position
   */
  async function scrollTo(targetY) {
    return new Promise(resolve => {
      const startY = window.scrollY;

      // If already at target, resolve immediately
      if (Math.abs(targetY - startY) < 10) {
        resolve();
        return;
      }

      // Use instant scroll for speed during extraction
      window.scrollTo({
        top: targetY,
        behavior: 'auto'
      });

      // Wait for scroll to settle
      setTimeout(resolve, CONFIG.scrollDelay);
    });
  }

  /**
   * Wait for images in viewport to finish loading
   */
  async function waitForVisibleImages() {
    const visibleImages = getVisibleImages();

    // Wait for lazy loading to trigger
    await wait(CONFIG.loadWaitTime);

    // Wait for images that have src but aren't complete
    const loadingImages = visibleImages.filter(img => img.src && !img.complete);

    if (loadingImages.length === 0) return;

    const loadPromises = loadingImages.map(img =>
      new Promise(resolve => {
        if (img.complete) {
          resolve();
          return;
        }

        const timeout = setTimeout(resolve, CONFIG.imageLoadTimeout);

        const cleanup = () => {
          clearTimeout(timeout);
          resolve();
        };

        img.addEventListener('load', cleanup, { once: true });
        img.addEventListener('error', cleanup, { once: true });
      })
    );

    await Promise.all(loadPromises);
  }

  /**
   * Get the maximum scrollable height
   */
  function getMaxScroll() {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ) - window.innerHeight;
  }

  /**
   * Get current document height
   */
  function getDocumentHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
  }

  /**
   * Main function: Scroll through page to trigger lazy loading
   *
   * @returns {Promise<Object>} Scroll results with statistics
   */
  async function triggerLazyLoading() {
    const startTime = Date.now();
    const originalScrollPosition = window.scrollY;
    const initialImageCount = countLoadedImages();
    const initialDocHeight = getDocumentHeight();

    let scrollCount = 0;
    let lastDocHeight = initialDocHeight;
    let unchangedHeightCount = 0;

    // If page fits in viewport, just wait for visible images
    if (initialDocHeight <= window.innerHeight + 100) {
      await waitForVisibleImages();
      return {
        scrolled: false,
        reason: 'Page fits in viewport',
        imagesLoadedBefore: initialImageCount,
        imagesLoadedAfter: countLoadedImages(),
        timeSpent: Date.now() - startTime
      };
    }

    // Progressive scroll through the page
    let currentPosition = 0;

    while (scrollCount < CONFIG.maxScrolls) {
      // Check timeout
      if (Date.now() - startTime > CONFIG.maxScrollTime) {
        break;
      }

      // Calculate next scroll position
      currentPosition += CONFIG.scrollStep;
      const maxScroll = getMaxScroll();

      // Check if we've reached the bottom
      if (currentPosition >= maxScroll) {
        // Scroll to absolute bottom
        await scrollTo(maxScroll);
        await waitForVisibleImages();
        break;
      }

      // Scroll to next position
      await scrollTo(currentPosition);
      await waitForVisibleImages();
      scrollCount++;

      // Check for infinite scroll (page height growing)
      const currentDocHeight = getDocumentHeight();

      if (currentDocHeight === lastDocHeight) {
        unchangedHeightCount++;
        // If height unchanged for 3 iterations near bottom, stop
        if (unchangedHeightCount >= 3 && currentPosition >= maxScroll - CONFIG.scrollStep) {
          break;
        }
      } else {
        unchangedHeightCount = 0;
        lastDocHeight = currentDocHeight;
      }
    }

    // Final wait for any remaining lazy loads
    await wait(CONFIG.finalWait);

    // Return to original position
    if (CONFIG.returnToTop) {
      window.scrollTo({
        top: originalScrollPosition,
        behavior: 'auto'
      });
      await wait(100);
    }

    const finalImageCount = countLoadedImages();

    return {
      scrolled: true,
      scrollSteps: scrollCount,
      timeSpent: Date.now() - startTime,
      imagesLoadedBefore: initialImageCount,
      imagesLoadedAfter: finalImageCount,
      newImagesLoaded: finalImageCount - initialImageCount
    };
  }

  // Expose the function globally for content scripts to use
  window.triggerLazyLoading = triggerLazyLoading;

})();
