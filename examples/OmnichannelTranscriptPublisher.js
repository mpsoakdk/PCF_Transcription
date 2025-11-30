/**
 * Omnichannel Transcript Publisher - Web Resource
 * 
 * This JavaScript web resource monitors the Omnichannel conversation panel
 * and publishes transcript updates to the LiveTranscriptControl PCF control.
 * 
 * HOW TO USE:
 * 1. Upload this file as a JavaScript web resource in Dynamics 365
 * 2. Add it to the Conversation form (msdyn_ocsession) OnLoad event
 * 3. Publish the form
 * 
 * INTEGRATION APPROACHES:
 * - DOM Monitoring (Option 1): Watches transcript panel for changes
 * - Omnichannel API Hooks (Option 2): Uses Microsoft APIs if available
 * - Manual Publishing (Option 3): Exposes API for manual event publishing
 * 
 * IMPORTANT NOTES:
 * - Adjust DOM selectors based on your Omnichannel UI version
 * - Test thoroughly before deploying to production
 * - Monitor for Microsoft API updates that may provide better integration
 * 
 * @author Your Organization
 * @version 1.0.0
 * @date November 2025
 */

var OmnichannelTranscriptPublisher = OmnichannelTranscriptPublisher || {};

(function(publisher) {
    "use strict";
    
    // Configuration
    const CONFIG = {
        // Enable/disable different integration methods
        enableDOMMonitoring: true,
        enableAPIHooks: true,
        enableManualMode: true,
        
        // DOM selectors (update these based on actual Omnichannel UI)
        selectors: {
            transcriptPanel: '[data-id="transcript-panel"], .transcript-container, #transcriptPanel',
            transcriptMessage: '.transcript-message, .conversation-message',
            speaker: '.speaker, .message-sender',
            messageText: '.message-text, .utterance-text',
            timestamp: '.message-timestamp, [data-timestamp]'
        },
        
        // Polling interval for fallback (ms)
        pollingInterval: 2000,
        
        // Debug logging
        debug: true
    };
    
    // State
    let _initialized = false;
    let _observer = null;
    let _formContext = null;
    let _conversationId = null;
    let _processedMessages = new Set(); // Track processed messages to avoid duplicates
    
    /**
     * Initialize the publisher
     * Called from form OnLoad event
     */
    publisher.initialize = function(executionContext) {
        if (_initialized) {
            log("Already initialized");
            return;
        }
        
        try {
            _formContext = executionContext.getFormContext();
            _conversationId = getConversationId();
            
            log("Initializing Transcript Publisher for conversation:", _conversationId);
            
            if (!_conversationId) {
                logError("No conversation ID found");
                return;
            }
            
            // Try different integration methods
            if (CONFIG.enableAPIHooks) {
                initializeAPIHooks();
            }
            
            if (CONFIG.enableDOMMonitoring) {
                initializeDOMMonitoring();
            }
            
            if (CONFIG.enableManualMode) {
                exposeManualAPI();
            }
            
            _initialized = true;
            log("Transcript Publisher initialized successfully");
            
        } catch (error) {
            logError("Error initializing:", error);
        }
    };
    
    /**
     * Clean up when form is closed
     */
    publisher.cleanup = function() {
        if (_observer) {
            _observer.disconnect();
            _observer = null;
        }
        
        _initialized = false;
        _processedMessages.clear();
        log("Transcript Publisher cleaned up");
    };
    
    /**
     * Get the current conversation ID from the form
     */
    function getConversationId() {
        try {
            if (_formContext && _formContext.data && _formContext.data.entity) {
                const id = _formContext.data.entity.getId();
                return id ? id.replace(/[{}]/g, '') : null;
            }
        } catch (error) {
            logError("Error getting conversation ID:", error);
        }
        return null;
    }
    
    /**
     * INTEGRATION METHOD 1: DOM Monitoring
     * Monitors the Omnichannel transcript panel for new messages
     */
    function initializeDOMMonitoring() {
        log("Initializing DOM monitoring...");
        
        // Try to find the transcript panel
        const transcriptPanel = findTranscriptPanel();
        
        if (!transcriptPanel) {
            log("Transcript panel not found, will retry...");
            // Retry after delay (panel might load later)
            setTimeout(initializeDOMMonitoring, CONFIG.pollingInterval);
            return;
        }
        
        log("Found transcript panel, setting up observer");
        
        // Set up MutationObserver to watch for new messages
        _observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Element node
                        processNewNode(node);
                    }
                });
            });
        });
        
        _observer.observe(transcriptPanel, {
            childList: true,
            subtree: true
        });
        
        log("DOM monitoring active");
        
        // Also process existing messages
        processExistingMessages(transcriptPanel);
    }
    
    /**
     * Find the transcript panel in the DOM
     */
    function findTranscriptPanel() {
        const selectors = CONFIG.selectors.transcriptPanel.split(',');
        
        for (let i = 0; i < selectors.length; i++) {
            const element = document.querySelector(selectors[i].trim());
            if (element) {
                return element;
            }
        }
        
        return null;
    }
    
    /**
     * Process a newly added DOM node
     */
    function processNewNode(node) {
        // Check if this node or its children contain transcript messages
        const messages = findTranscriptMessages(node);
        
        messages.forEach(function(messageElement) {
            extractAndPublishMessage(messageElement);
        });
    }
    
    /**
     * Process existing messages in the transcript panel
     */
    function processExistingMessages(panel) {
        const messages = findTranscriptMessages(panel);
        log("Processing " + messages.length + " existing messages");
        
        messages.forEach(function(messageElement) {
            extractAndPublishMessage(messageElement);
        });
    }
    
    /**
     * Find transcript message elements within a container
     */
    function findTranscriptMessages(container) {
        const selectors = CONFIG.selectors.transcriptMessage.split(',');
        const messages = [];
        
        selectors.forEach(function(selector) {
            const elements = container.querySelectorAll
                ? container.querySelectorAll(selector.trim())
                : (container.matches && container.matches(selector.trim()) ? [container] : []);
            
            for (let i = 0; i < elements.length; i++) {
                messages.push(elements[i]);
            }
        });
        
        return messages;
    }
    
    /**
     * Extract transcript data from a message element and publish it
     */
    function extractAndPublishMessage(messageElement) {
        try {
            // Generate unique ID for this message to avoid duplicates
            const messageId = getMessageId(messageElement);
            
            if (_processedMessages.has(messageId)) {
                return; // Already processed
            }
            
            // Extract data from DOM
            const speaker = extractSpeaker(messageElement);
            const text = extractText(messageElement);
            const timestamp = extractTimestamp(messageElement);
            
            if (!text || text.trim() === '') {
                return; // No text to publish
            }
            
            // Publish the transcript update
            publishTranscriptUpdate(speaker, text, timestamp);
            
            // Mark as processed
            _processedMessages.add(messageId);
            
        } catch (error) {
            logError("Error extracting message:", error);
        }
    }
    
    /**
     * Get a unique ID for a message element
     */
    function getMessageId(element) {
        // Try to use existing ID or data attribute
        if (element.id) return element.id;
        if (element.dataset && element.dataset.messageId) return element.dataset.messageId;
        
        // Generate based on text content and position
        const text = extractText(element);
        const timestamp = extractTimestamp(element);
        return text.substring(0, 50) + '_' + timestamp;
    }
    
    /**
     * Extract speaker from message element
     */
    function extractSpeaker(element) {
        const selectors = CONFIG.selectors.speaker.split(',');
        
        for (let i = 0; i < selectors.length; i++) {
            const speakerElement = element.querySelector(selectors[i].trim());
            if (speakerElement && speakerElement.textContent) {
                return speakerElement.textContent.trim();
            }
        }
        
        // Try data attributes
        if (element.dataset) {
            if (element.dataset.speaker) return element.dataset.speaker;
            if (element.dataset.sender) return element.dataset.sender;
        }
        
        // Check CSS classes for agent/customer indicators
        if (element.classList) {
            if (element.classList.contains('agent-message')) return 'Agent';
            if (element.classList.contains('customer-message')) return 'Customer';
            if (element.classList.contains('system-message')) return 'System';
        }
        
        return 'Unknown';
    }
    
    /**
     * Extract text from message element
     */
    function extractText(element) {
        const selectors = CONFIG.selectors.messageText.split(',');
        
        for (let i = 0; i < selectors.length; i++) {
            const textElement = element.querySelector(selectors[i].trim());
            if (textElement && textElement.textContent) {
                return textElement.textContent.trim();
            }
        }
        
        // Fallback to element's text content
        return element.textContent ? element.textContent.trim() : '';
    }
    
    /**
     * Extract timestamp from message element
     */
    function extractTimestamp(element) {
        const selectors = CONFIG.selectors.timestamp.split(',');
        
        for (let i = 0; i < selectors.length; i++) {
            const timestampElement = element.querySelector(selectors[i].trim());
            if (timestampElement) {
                // Check data attribute first
                if (timestampElement.dataset && timestampElement.dataset.timestamp) {
                    return timestampElement.dataset.timestamp;
                }
                // Try parsing text content
                if (timestampElement.textContent) {
                    return timestampElement.textContent.trim();
                }
            }
        }
        
        // Check element's own data attributes
        if (element.dataset && element.dataset.timestamp) {
            return element.dataset.timestamp;
        }
        
        // Fallback to current time
        return new Date().toISOString();
    }
    
    /**
     * INTEGRATION METHOD 2: API Hooks
     * Attempt to hook into Omnichannel APIs if available
     */
    function initializeAPIHooks() {
        log("Checking for Omnichannel APIs...");
        
        // Check for Microsoft.Omnichannel namespace
        if (typeof Microsoft !== 'undefined' && Microsoft.Omnichannel) {
            log("Microsoft.Omnichannel detected");
            
            try {
                // Attempt to subscribe to transcript events
                // Note: This is speculative - actual API may differ
                if (Microsoft.Omnichannel.on) {
                    Microsoft.Omnichannel.on('transcriptUpdate', function(data) {
                        log("Received transcript from API:", data);
                        publishTranscriptUpdate(
                            data.speaker || 'Unknown',
                            data.text || '',
                            data.timestamp || new Date().toISOString(),
                            data.sentiment
                        );
                    });
                    log("Subscribed to Omnichannel transcript events");
                }
            } catch (error) {
                log("Could not subscribe to Omnichannel events:", error);
            }
        }
        
        // Check for other potential API surfaces
        checkForAlternativeAPIs();
    }
    
    /**
     * Check for alternative API surfaces
     */
    function checkForAlternativeAPIs() {
        // Check for Copilot Studio APIs
        if (typeof Microsoft !== 'undefined' && Microsoft.CIFramework) {
            log("Microsoft.CIFramework detected");
            // Future integration point
        }
        
        // Check for App Profile Manager
        if (typeof Microsoft !== 'undefined' && Microsoft.Apm) {
            log("Microsoft.Apm detected");
            // Future integration point
        }
    }
    
    /**
     * INTEGRATION METHOD 3: Manual API
     * Expose API for manual event publishing (testing/debugging)
     */
    function exposeManualAPI() {
        window.OmnichannelTranscriptPublisher = window.OmnichannelTranscriptPublisher || {};
        
        // Manual publish method
        window.OmnichannelTranscriptPublisher.publish = function(speaker, text, timestamp, sentiment) {
            publishTranscriptUpdate(speaker, text, timestamp || new Date().toISOString(), sentiment);
        };
        
        // Test method
        window.OmnichannelTranscriptPublisher.test = function() {
            log("Publishing test messages...");
            
            publishTranscriptUpdate('Agent', 'Hello, how can I help you today?', new Date().toISOString());
            
            setTimeout(function() {
                publishTranscriptUpdate('Customer', 'I have a question about my recent order.', new Date().toISOString());
            }, 1000);
            
            setTimeout(function() {
                publishTranscriptUpdate('Agent', 'I\'d be happy to help with that. Could you provide your order number?', new Date().toISOString());
            }, 2000);
        };
        
        log("Manual API exposed: window.OmnichannelTranscriptPublisher.publish(speaker, text, timestamp)");
        log("Test with: window.OmnichannelTranscriptPublisher.test()");
    }
    
    /**
     * Publish a transcript update event to the PCF control
     */
    function publishTranscriptUpdate(speaker, text, timestamp, sentiment) {
        if (!_conversationId) {
            logError("Cannot publish: No conversation ID");
            return;
        }
        
        const event = new CustomEvent('omnichannelTranscriptUpdate', {
            detail: {
                conversationId: _conversationId,
                utterance: {
                    speaker: speaker,
                    text: text,
                    timestamp: timestamp,
                    sentiment: sentiment
                }
            }
        });
        
        window.dispatchEvent(event);
        log("Published transcript:", speaker + ": " + text.substring(0, 50) + "...");
    }
    
    /**
     * Logging helpers
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log("[Omnichannel Transcript Publisher]", message, arguments.length > 1 ? Array.prototype.slice.call(arguments, 1) : '');
        }
    }
    
    function logError(message) {
        console.error("[Omnichannel Transcript Publisher]", message, arguments.length > 1 ? Array.prototype.slice.call(arguments, 1) : '');
    }
    
})(OmnichannelTranscriptPublisher);

/**
 * Form OnLoad Event Handler
 * 
 * Add this to the Conversation form's OnLoad event:
 * 1. Go to Form Properties > Events > OnLoad
 * 2. Add this web resource as a library
 * 3. Add function: OmnichannelTranscriptPublisher.initialize
 * 4. Pass execution context: Yes
 */
