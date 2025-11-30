/**
 * Transcript Monitor for PCF Control Integration
 * 
 * This script provides a monitoring system that can be integrated into your PCF control
 * to capture live transcript updates from the Dynamics 365 conversation iframe.
 * 
 * Integration Steps:
 * 1. Include this script logic in your PCF control's init or updateView method
 * 2. Call TranscriptMonitor.initialize() when your control loads
 * 3. Register a callback to receive transcript updates
 * 4. The callback will receive transcript data to display in your control
 * 
 * Usage in PCF Control:
 * ```typescript
 * // In your index.ts init method:
 * const monitor = TranscriptMonitor.initialize((data) => {
 *     // Update your React component with new transcript data
 *     notifyOutputChanged();
 * });
 * 
 * // In destroy method:
 * TranscriptMonitor.destroy();
 * ```
 */

const TranscriptMonitor = (function() {
    'use strict';
    
    let config = {
        iframe: null,
        iframeDoc: null,
        observer: null,
        isMonitoring: false,
        transcriptContainer: null,
        callback: null,
        pollInterval: null
    };
    
    const state = {
        messages: [],
        lastMessageCount: 0
    };
    
    /**
     * Initialize the monitor
     */
    function initialize(callback, options = {}) {
        console.log("[TranscriptMonitor] Initializing...");
        
        config.callback = callback;
        
        // Configuration options
        const settings = {
            autoStart: options.autoStart !== false,
            pollIntervalMs: options.pollIntervalMs || 1000,
            iframeSelector: options.iframeSelector || '#SidePanelIFrame',
            retryAttempts: options.retryAttempts || 10,
            retryDelayMs: options.retryDelayMs || 2000
        };
        
        if (settings.autoStart) {
            attemptConnection(0, settings);
        }
        
        return {
            start: () => startMonitoring(settings),
            stop: stopMonitoring,
            getMessages: () => state.messages,
            isActive: () => config.isMonitoring
        };
    }
    
    /**
     * Attempt to connect to iframe with retries
     */
    function attemptConnection(attempt, settings) {
        console.log(`[TranscriptMonitor] Connection attempt ${attempt + 1}/${settings.retryAttempts}`);
        
        const iframe = findConversationIFrame(settings.iframeSelector);
        
        if (iframe) {
            const iframeDoc = getIFrameDocument(iframe);
            if (iframeDoc) {
                config.iframe = iframe;
                config.iframeDoc = iframeDoc;
                startMonitoring(settings);
                console.log("[TranscriptMonitor] ✓ Connected successfully");
                return true;
            }
        }
        
        // Retry if not found
        if (attempt < settings.retryAttempts - 1) {
            setTimeout(() => {
                attemptConnection(attempt + 1, settings);
            }, settings.retryDelayMs);
        } else {
            console.error("[TranscriptMonitor] ❌ Failed to connect after all attempts");
            console.log("[TranscriptMonitor] Falling back to polling mode");
            startPollingMode(settings);
        }
        
        return false;
    }
    
    /**
     * Find the conversation iframe
     */
    function findConversationIFrame(selector) {
        // Try direct selector
        let iframe = document.querySelector(selector);
        
        // Fallback strategies
        if (!iframe) {
            iframe = document.querySelector('iframe[title*="Conversation"]');
        }
        if (!iframe) {
            iframe = document.querySelector('iframe[src*="cec_widgets"]');
        }
        if (!iframe) {
            const iframes = document.querySelectorAll('iframe');
            iframe = Array.from(iframes).find(f => 
                f.id?.toLowerCase().includes('conversation') ||
                f.title?.toLowerCase().includes('conversation') ||
                f.src?.includes('widgets')
            );
        }
        
        return iframe;
    }
    
    /**
     * Access iframe document safely
     */
    function getIFrameDocument(iframe) {
        try {
            return iframe.contentDocument || iframe.contentWindow?.document;
        } catch (e) {
            console.warn("[TranscriptMonitor] Cannot access iframe:", e.message);
            return null;
        }
    }
    
    /**
     * Start monitoring transcript changes
     */
    function startMonitoring(settings) {
        if (config.isMonitoring) {
            console.log("[TranscriptMonitor] Already monitoring");
            return;
        }
        
        if (!config.iframeDoc) {
            console.error("[TranscriptMonitor] No iframe document available");
            return;
        }
        
        // Find transcript container
        config.transcriptContainer = findTranscriptContainer(config.iframeDoc);
        
        if (!config.transcriptContainer) {
            console.warn("[TranscriptMonitor] Transcript container not found, monitoring entire body");
            config.transcriptContainer = config.iframeDoc.body;
        }
        
        // Set up MutationObserver
        config.observer = new MutationObserver((mutations) => {
            handleMutations(mutations);
        });
        
        config.observer.observe(config.transcriptContainer, {
            childList: true,
            subtree: true,
            characterData: true,
            characterDataOldValue: true
        });
        
        config.isMonitoring = true;
        console.log("[TranscriptMonitor] ✓ Monitoring started");
        
        // Initial scan for existing messages
        scanForMessages();
    }
    
    /**
     * Find the container that holds transcript messages
     */
    function findTranscriptContainer(doc) {
        const selectors = [
            '[role="log"]',
            '[role="feed"]',
            '[data-id*="transcript"]',
            '[data-id*="conversation"]',
            '[class*="transcript" i]',
            '[class*="conversation" i]',
            '[class*="messages" i]',
            '[aria-label*="message" i]'
        ];
        
        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element && element.children.length > 0) {
                console.log(`[TranscriptMonitor] Found container: ${selector}`);
                return element;
            }
        }
        
        return null;
    }
    
    /**
     * Handle DOM mutations
     */
    function handleMutations(mutations) {
        let hasNewContent = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                hasNewContent = true;
            } else if (mutation.type === 'characterData') {
                hasNewContent = true;
            }
        });
        
        if (hasNewContent) {
            scanForMessages();
        }
    }
    
    /**
     * Scan for transcript messages
     */
    function scanForMessages() {
        if (!config.transcriptContainer) return;
        
        const newMessages = extractMessages(config.transcriptContainer);
        
        if (newMessages.length !== state.lastMessageCount) {
            state.lastMessageCount = newMessages.length;
            state.messages = newMessages;
            
            if (config.callback) {
                config.callback({
                    type: 'messages_updated',
                    messages: newMessages,
                    timestamp: new Date()
                });
            }
        }
    }
    
    /**
     * Extract message objects from DOM
     */
    function extractMessages(container) {
        const messages = [];
        
        // Strategy 1: Look for repeating patterns (likely individual messages)
        const candidates = container.querySelectorAll('div, li, article');
        const classCounts = {};
        
        candidates.forEach(el => {
            const className = Array.from(el.classList).sort().join(' ');
            if (className && el.textContent.trim().length > 5) {
                classCounts[className] = (classCounts[className] || 0) + 1;
            }
        });
        
        // Find most common class (likely the message container)
        let messageClass = null;
        let maxCount = 0;
        Object.keys(classCounts).forEach(className => {
            if (classCounts[className] > maxCount && classCounts[className] >= 2) {
                maxCount = classCounts[className];
                messageClass = className;
            }
        });
        
        // Extract messages
        if (messageClass) {
            const messageElements = Array.from(candidates).filter(el => 
                Array.from(el.classList).sort().join(' ') === messageClass
            );
            
            messageElements.forEach((el, index) => {
                messages.push(parseMessageElement(el, index));
            });
        } else {
            // Fallback: treat each direct child as a message
            Array.from(container.children).forEach((el, index) => {
                const text = el.textContent.trim();
                if (text.length > 0) {
                    messages.push(parseMessageElement(el, index));
                }
            });
        }
        
        return messages;
    }
    
    /**
     * Parse a message element into structured data
     */
    function parseMessageElement(element, index) {
        const text = element.textContent.trim();
        
        // Try to extract speaker (look for bold text, specific classes, etc.)
        let speaker = 'Unknown';
        const boldElements = element.querySelectorAll('strong, b, [class*="speaker" i], [class*="name" i]');
        if (boldElements.length > 0) {
            speaker = boldElements[0].textContent.trim();
        }
        
        // Try to extract timestamp
        let timestamp = new Date();
        const timeElements = element.querySelectorAll('time, [class*="time" i], [class*="timestamp" i]');
        if (timeElements.length > 0) {
            const timeText = timeElements[0].textContent.trim();
            const parsed = parseTimeString(timeText);
            if (parsed) timestamp = parsed;
        }
        
        // Detect sentiment (basic keyword analysis)
        const sentiment = detectSentiment(text);
        
        return {
            id: `msg_${index}_${Date.now()}`,
            speaker: speaker,
            text: text,
            timestamp: timestamp,
            sentiment: sentiment,
            element: element
        };
    }
    
    /**
     * Parse time string to Date
     */
    function parseTimeString(timeStr) {
        // Try parsing common time formats
        const parsed = new Date(timeStr);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    
    /**
     * Basic sentiment detection
     */
    function detectSentiment(text) {
        const lowerText = text.toLowerCase();
        
        const positiveWords = ['tak', 'godt', 'perfekt', 'fantastisk', 'glad', 'yes', 'great', 'good'];
        const negativeWords = ['problem', 'fejl', 'dårlig', 'nej', 'ikke', 'issue', 'error', 'bad'];
        
        let score = 0;
        positiveWords.forEach(word => {
            if (lowerText.includes(word)) score += 1;
        });
        negativeWords.forEach(word => {
            if (lowerText.includes(word)) score -= 1;
        });
        
        if (score > 0) return 'positive';
        if (score < 0) return 'negative';
        return 'neutral';
    }
    
    /**
     * Fallback: Poll for changes instead of using MutationObserver
     */
    function startPollingMode(settings) {
        console.log("[TranscriptMonitor] Starting polling mode");
        
        config.pollInterval = setInterval(() => {
            const iframe = findConversationIFrame(settings.iframeSelector);
            if (iframe) {
                const iframeDoc = getIFrameDocument(iframe);
                if (iframeDoc) {
                    config.iframe = iframe;
                    config.iframeDoc = iframeDoc;
                    config.transcriptContainer = findTranscriptContainer(iframeDoc);
                    
                    if (config.transcriptContainer) {
                        scanForMessages();
                    }
                }
            }
        }, settings.pollIntervalMs);
    }
    
    /**
     * Stop monitoring
     */
    function stopMonitoring() {
        if (config.observer) {
            config.observer.disconnect();
            config.observer = null;
        }
        
        if (config.pollInterval) {
            clearInterval(config.pollInterval);
            config.pollInterval = null;
        }
        
        config.isMonitoring = false;
        console.log("[TranscriptMonitor] ✓ Monitoring stopped");
    }
    
    /**
     * Destroy and cleanup
     */
    function destroy() {
        stopMonitoring();
        config = {
            iframe: null,
            iframeDoc: null,
            observer: null,
            isMonitoring: false,
            transcriptContainer: null,
            callback: null,
            pollInterval: null
        };
        state.messages = [];
        state.lastMessageCount = 0;
        console.log("[TranscriptMonitor] ✓ Destroyed");
    }
    
    // Public API
    return {
        initialize,
        destroy,
        getMessages: () => state.messages,
        isMonitoring: () => config.isMonitoring
    };
})();

// Usage example
console.log("TranscriptMonitor loaded!");
console.log("\nUsage:");
console.log("  const monitor = TranscriptMonitor.initialize((data) => {");
console.log("      console.log('New transcript data:', data);");
console.log("  });");
console.log("\nIntegration in PCF Control:");
console.log("  1. Copy this logic into your PCF control");
console.log("  2. Call initialize() in your init() method");
console.log("  3. Update your React state in the callback");
console.log("  4. Call destroy() in your destroy() method");
