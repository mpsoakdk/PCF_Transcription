/**
 * IFrame Transcript Finder
 * 
 * Targeted script for finding and monitoring transcripts inside the Dynamics 365 
 * conversation widget iframe (#SidePanelIFrame)
 * 
 * Usage:
 * 1. Start a voice call in Customer Service workspace
 * 2. Open browser DevTools (F12)
 * 3. Paste this script into the console
 * 4. Run: IFrameTranscriptFinder.findTranscript()
 * 5. To set up monitoring: IFrameTranscriptFinder.startMonitoring()
 */

const IFrameTranscriptFinder = (function() {
    'use strict';
    
    let monitoringActive = false;
    let observer = null;
    
    // Known transcript text patterns
    const knownPatterns = [
        "Optagelse og transkription startet",
        "deltager nu i kundesamtalen",
        "Hvad kan jeg gøre for dig"
    ];
    
    /**
     * Get the outer conversation widget iframe
     */
    function getConversationIFrame() {
        // Try specific ID first
        let iframe = document.getElementById('SidePanelIFrame');
        
        // Fallback: search by title
        if (!iframe) {
            const iframes = document.querySelectorAll('iframe[title*="Conversation"]');
            if (iframes.length > 0) iframe = iframes[0];
        }
        
        // Fallback: search by src pattern
        if (!iframe) {
            const iframes = document.querySelectorAll('iframe[src*="cec_widgets"]');
            if (iframes.length > 0) iframe = iframes[0];
        }
        
        return iframe;
    }
    
    /**
     * Get the inner Omnichannel iframe (where transcript actually lives)
     */
    function getOmnichannelIFrame() {
        try {
            const outerIframe = getConversationIFrame();
            if (!outerIframe) return null;
            
            const outerDoc = outerIframe.contentDocument;
            if (!outerDoc) return null;
            
            // Find the nested Omnichannel iframe
            const innerIframe = outerDoc.querySelector('iframe[title="Omnichannel"]');
            return innerIframe;
        } catch (e) {
            console.error('Error accessing nested iframe:', e.message);
            return null;
        }
    }
    
    /**
     * Access iframe document safely
     */
    function getIFrameDocument(iframe) {
        try {
            return iframe.contentDocument || iframe.contentWindow?.document;
        } catch (e) {
            console.error('Cannot access iframe content:', e.message);
            console.log('This may be due to cross-origin restrictions.');
            return null;
        }
    }
    
    /**
     * Deep search for transcript elements in iframe
     */
    function searchIFrameForTranscript(iframeDoc) {
        const results = {
            textElements: [],
            containers: [],
            messageElements: [],
            transcriptMessages: []
        };
        
        if (!iframeDoc || !iframeDoc.body) {
            return results;
        }
        
        // NEW: Look for webchat transcript articles
        const articles = iframeDoc.querySelectorAll('article.webchat__basic-transcript__activity');
        if (articles.length > 0) {
            articles.forEach(article => {
                // Extract message text from the markdown div
                const messageDiv = article.querySelector('.webchat__render-markdown div');
                const textContent = article.querySelector('.webchat__text-content__markdown');
                const senderLabel = article.querySelector('.webchat--css-wwipp-111jw2m');
                
                if (textContent) {
                    results.transcriptMessages.push({
                        element: article,
                        text: messageDiv ? messageDiv.textContent.trim() : textContent.textContent.trim(),
                        sender: senderLabel ? senderLabel.textContent.trim() : 'Unknown',
                        fullElement: article
                    });
                }
            });
        }
        
        // Search for known text patterns
        const walker = iframeDoc.createTreeWalker(
            iframeDoc.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text.length > 0) {
                knownPatterns.forEach(pattern => {
                    if (text.includes(pattern)) {
                        results.textElements.push({
                            pattern: pattern,
                            text: text,
                            element: node.parentElement,
                            path: getElementPath(node.parentElement)
                        });
                    }
                });
            }
        }
        
        // Search for conversation/message containers
        const containerSelectors = [
            '[data-id*="transcript"]',
            '[data-id*="conversation"]',
            '[data-id*="message"]',
            '[class*="transcript" i]',
            '[class*="conversation" i]',
            '[class*="message" i]',
            '[class*="chat" i]',
            '[role="log"]',
            '[role="feed"]',
            '[aria-label*="message" i]',
            '[aria-label*="conversation" i]',
            '[aria-label*="transcript" i]'
        ];
        
        containerSelectors.forEach(selector => {
            try {
                const elements = iframeDoc.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el.textContent.trim().length > 0) {
                        results.containers.push({
                            selector: selector,
                            element: el,
                            id: el.id,
                            classes: Array.from(el.classList).join(' '),
                            role: el.getAttribute('role'),
                            ariaLabel: el.getAttribute('aria-label'),
                            childCount: el.children.length,
                            textLength: el.textContent.length
                        });
                    }
                });
            } catch (e) {
                // Selector might not be valid in this context
            }
        });
        
        // Look for repeating message-like structures
        const allDivs = iframeDoc.querySelectorAll('div');
        const divGroups = {};
        
        allDivs.forEach(div => {
            const className = Array.from(div.classList).sort().join(' ');
            if (className && div.textContent.trim().length > 10) {
                if (!divGroups[className]) {
                    divGroups[className] = [];
                }
                divGroups[className].push(div);
            }
        });
        
        // Find classes that appear multiple times (likely messages)
        Object.keys(divGroups).forEach(className => {
            if (divGroups[className].length >= 2) {
                results.messageElements.push({
                    className: className,
                    count: divGroups[className].length,
                    elements: divGroups[className],
                    sampleText: divGroups[className][0].textContent.substring(0, 100)
                });
            }
        });
        
        return results;
    }
    
    /**
     * Get element path for debugging
     */
    function getElementPath(element, maxDepth = 5) {
        const path = [];
        let current = element;
        let depth = 0;
        
        while (current && depth < maxDepth) {
            const info = {
                tag: current.tagName,
                id: current.id || null,
                classes: Array.from(current.classList || []).slice(0, 3).join(' ')
            };
            path.push(info);
            current = current.parentElement;
            depth++;
        }
        
        return path;
    }
    
    /**
     * Main function to find transcript
     */
    function findTranscript() {
        console.log("=== IFrame Transcript Finder ===\n");
        
        // Step 1: Find the outer iframe
        console.log("Step 1: Locating outer conversation iframe...");
        const outerIframe = getConversationIFrame();
        
        if (!outerIframe) {
            console.error("❌ Could not find outer conversation iframe");
            console.log("Suggestions:");
            console.log("  - Make sure you're on a page with an active conversation");
            console.log("  - Try running the general DiagnosticScript.js first");
            return null;
        }
        
        console.log("✓ Found outer iframe:");
        console.log(`  ID: ${outerIframe.id}`);
        
        // Step 2: Find the inner Omnichannel iframe
        console.log("\nStep 2: Locating inner Omnichannel iframe...");
        const innerIframe = getOmnichannelIFrame();
        
        if (!innerIframe) {
            console.error("❌ Could not find inner Omnichannel iframe");
            return null;
        }
        
        console.log("✓ Found inner iframe:");
        console.log(`  Title: ${innerIframe.title}`);
        
        // Step 3: Access inner iframe content
        console.log("\nStep 3: Accessing inner iframe content...");
        const iframeDoc = getIFrameDocument(innerIframe);
        
        if (!iframeDoc) {
            console.error("❌ Cannot access inner iframe content (cross-origin restriction)");
            console.error("The transcript is in a sandboxed iframe from a different domain.");
            console.log("\n⚠️ SOLUTION: You'll need to use Dynamics 365 Omnichannel SDK/Events instead of DOM access.");
            return null;
        }
        
        console.log("✓ Successfully accessed inner iframe document");
        console.log(`  Document title: ${iframeDoc.title}`);
        console.log(`  Body exists: ${!!iframeDoc.body}`);
        console.log(`  Body text length: ${iframeDoc.body?.textContent?.length || 0} characters`);
        
        // Step 4: Search for transcript
        console.log("\nStep 4: Searching for webchat transcript messages...");
        const results = searchIFrameForTranscript(iframeDoc);
        
        // Report findings
        console.log(`\nStep 5: Analysis Results`);
        console.log(`  Transcript messages found: ${results.transcriptMessages.length}`);
        console.log(`  Text elements found: ${results.textElements.length}`);
        console.log(`  Containers found: ${results.containers.length}`);
        console.log(`  Message patterns found: ${results.messageElements.length}`);
        
        if (results.transcriptMessages.length > 0) {
            console.log(`\n✓ Found ${results.transcriptMessages.length} transcript message(s):\n`);
            results.transcriptMessages.forEach((msg, idx) => {
                console.log(`  ${idx + 1}. ${msg.sender}`);
                console.log(`     Text: "${msg.text}"`);
                console.log(`     Element:`, msg.element);
            });
        } else {
            console.log("\n✗ No webchat transcript messages found");
            console.log("  Make sure transcription is active during the call.");
        }
        
        if (results.textElements.length > 0) {
            console.log(`\n✓ Found ${results.textElements.length} known transcript text(s):`);
            results.textElements.forEach((item, idx) => {
                console.log(`\n  ${idx + 1}. Pattern: "${item.pattern}"`);
                console.log(`     Text: "${item.text.substring(0, 100)}"`);
                console.log(`     Element:`, item.element);
                console.log(`     Path:`, item.path);
            });
        } else {
            console.log("\n✗ No known transcript text found");
            console.log("  The iframe might not contain the expected Danish text patterns.");
            console.log("  Try inspecting iframe content manually:");
            console.log("  > const iframe = document.getElementById('SidePanelIFrame');");
            console.log("  > console.log(iframe.contentDocument.body.textContent);");
        }
        
        if (results.containers.length > 0) {
            console.log(`\n✓ Found ${results.containers.length} potential container(s):`);
            results.containers.slice(0, 10).forEach((container, idx) => {
                console.log(`\n  ${idx + 1}. Selector: ${container.selector}`);
                console.log(`     ID: ${container.id || '(none)'}`);
                console.log(`     Classes: ${container.classes || '(none)'}`);
                console.log(`     Role: ${container.role || '(none)'}`);
                console.log(`     Children: ${container.childCount}`);
                console.log(`     Element:`, container.element);
            });
        }
        
        if (results.messageElements.length > 0) {
            console.log(`\n✓ Found ${results.messageElements.length} repeating message pattern(s):`);
            results.messageElements.slice(0, 5).forEach((group, idx) => {
                console.log(`\n  ${idx + 1}. Class: "${group.className}"`);
                console.log(`     Count: ${group.count} elements`);
                console.log(`     Sample: "${group.sampleText}"`);
                console.log(`     Elements:`, group.elements);
            });
        } else {
            console.log("\n✗ No repeating message patterns found");
            console.log("  The transcript might use a different structure.");
        }
        
        console.log("\n=== Search Complete ===");
        console.log("\nReturning results object with:");
        console.log(`  - outerIframe: ${outerIframe ? 'found' : 'null'}`);
        console.log(`  - innerIframe: ${innerIframe ? 'found' : 'null'}`);
        console.log(`  - iframeDoc: ${iframeDoc ? 'accessible' : 'null'}`);
        console.log(`  - results.transcriptMessages: ${results.transcriptMessages.length} items`);
        
        return {
            outerIframe: outerIframe,
            innerIframe: innerIframe,
            iframeDoc: iframeDoc,
            results: results
        };
    }
    
    /**
     * Start monitoring for transcript changes
     */
    function startMonitoring(callback) {
        if (monitoringActive) {
            console.log("⚠️ Monitoring already active");
            return;
        }
        
        console.log("Starting transcript monitoring...");
        
        const innerIframe = getOmnichannelIFrame();
        if (!innerIframe) {
            console.error("❌ Cannot start monitoring: inner iframe not found");
            return;
        }
        
        const iframeDoc = getIFrameDocument(innerIframe);
        if (!iframeDoc) {
            console.error("❌ Cannot start monitoring: cannot access inner iframe");
            return;
        }
        
        // Set up MutationObserver on the inner iframe
        observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        // Check if new node is a transcript article
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.classList && node.classList.contains('webchat__basic-transcript__activity')) {
                                const messageDiv = node.querySelector('.webchat__render-markdown div');
                                const senderLabel = node.querySelector('.webchat--css-wwipp-111jw2m');
                                
                                if (messageDiv) {
                                    const text = messageDiv.textContent.trim();
                                    const sender = senderLabel ? senderLabel.textContent.trim() : 'Unknown';
                                    
                                    console.log(`📝 New transcript message: [${sender}] "${text}"`);
                                    
                                    if (callback) {
                                        callback({
                                            type: 'new_message',
                                            text: text,
                                            sender: sender,
                                            node: node,
                                            timestamp: new Date()
                                        });
                                    }
                                }
                            }
                        }
                    });
                }
            });
        });
        
        observer.observe(iframeDoc.body, {
            childList: true,
            subtree: true
        });
        
        monitoringActive = true;
        console.log("✓ Monitoring started successfully");
        console.log("  Watching for new transcript messages in inner iframe...");
        console.log("  To stop: IFrameTranscriptFinder.stopMonitoring()");
    }
    
    /**
     * Stop monitoring
     */
    function stopMonitoring() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        monitoringActive = false;
        console.log("✓ Monitoring stopped");
    }
    
    // Public API
    return {
        findTranscript,
        startMonitoring,
        stopMonitoring,
        getConversationIFrame,
        getOmnichannelIFrame,
        isMonitoring: () => monitoringActive
    };
})();

// Auto-run on load
console.log("IFrame Transcript Finder loaded!");
console.log("Usage:");
console.log("  IFrameTranscriptFinder.findTranscript()      - Search for transcript elements");
console.log("  IFrameTranscriptFinder.startMonitoring(cb)   - Monitor for changes (optional callback)");
console.log("  IFrameTranscriptFinder.stopMonitoring()      - Stop monitoring");
