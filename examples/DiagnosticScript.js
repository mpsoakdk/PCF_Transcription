/**
 * Diagnostic Script for Finding Live Transcript Elements
 * 
 * This script helps you locate where Dynamics 365 displays the live voice transcript
 * Run this in the browser console during an active voice call to find the DOM elements
 * 
 * Usage:
 * 1. Start a voice call in Customer Service workspace
 * 2. Wait for transcription to start appearing
 * 3. Open browser DevTools (F12)
 * 4. Copy and paste this script into the console
 * 5. The script will scan the page and report where transcript text appears
 */

(function() {
    'use strict';
    
    console.log("=== Live Transcript Diagnostic Tool ===");
    console.log("Scanning page for transcript elements...\n");
    
    // Known transcript-related text patterns (from your screenshot)
    const knownTranscriptText = [
        "Optagelse og transkription startet",
        "Mike Poulsen deltager nu i kundesamtalen",
        "Hvad kan jeg gøre for dig?"
    ];
    
    // Search for elements containing transcript text
    function findElementsWithText(searchText) {
        const results = [];
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.includes(searchText)) {
                let element = node.parentElement;
                // Go up the tree to find the container
                let depth = 0;
                const path = [];
                while (element && depth < 5) {
                    const info = {
                        tag: element.tagName,
                        id: element.id,
                        classes: Array.from(element.classList || []).join(' '),
                        dataAttrs: getDataAttributes(element)
                    };
                    path.push(info);
                    element = element.parentElement;
                    depth++;
                }
                results.push({
                    text: searchText,
                    found: node.textContent.substring(0, 100),
                    path: path
                });
            }
        }
        return results;
    }
    
    // Get data attributes from an element
    function getDataAttributes(element) {
        const dataAttrs = {};
        if (element.dataset) {
            for (let key in element.dataset) {
                dataAttrs[key] = element.dataset[key];
            }
        }
        return dataAttrs;
    }
    
    // Look for common transcript container patterns
    function findTranscriptContainers(doc = document) {
        const patterns = [
            '[data-id*="transcript"]',
            '[class*="transcript"]',
            '[id*="transcript"]',
            '[data-id*="conversation"]',
            '[class*="conversation"]',
            '[class*="message"]',
            '[class*="chat"]',
            '[aria-label*="transcript"]',
            '[aria-label*="conversation"]',
            '[role="log"]',
            '[role="region"][aria-label*="message"]'
        ];
        
        const found = [];
        patterns.forEach(pattern => {
            const elements = doc.querySelectorAll(pattern);
            if (elements.length > 0) {
                elements.forEach(el => {
                    found.push({
                        selector: pattern,
                        element: el,
                        id: el.id,
                        classes: Array.from(el.classList || []).join(' '),
                        dataAttrs: getDataAttributes(el),
                        childCount: el.children.length,
                        hasText: el.textContent.length > 0
                    });
                });
            }
        });
        return found;
    }
    
    // Find and search inside iframes
    function searchIframes() {
        const iframes = document.querySelectorAll('iframe');
        const results = [];
        
        console.log(`\nFound ${iframes.length} iframe(s) on the page`);
        
        iframes.forEach((iframe, idx) => {
            try {
                const iframeInfo = {
                    index: idx,
                    id: iframe.id,
                    title: iframe.title,
                    src: iframe.src,
                    accessible: false,
                    transcriptContainers: [],
                    knownTextFound: []
                };
                
                // Try to access iframe content
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                
                if (iframeDoc) {
                    iframeInfo.accessible = true;
                    
                    // Search for known transcript text in iframe
                    knownTranscriptText.forEach(text => {
                        const walker = iframeDoc.createTreeWalker(
                            iframeDoc.body || iframeDoc.documentElement,
                            NodeFilter.SHOW_TEXT,
                            null,
                            false
                        );
                        
                        let node;
                        while (node = walker.nextNode()) {
                            if (node.textContent.includes(text)) {
                                iframeInfo.knownTextFound.push({
                                    text: text,
                                    element: node.parentElement
                                });
                            }
                        }
                    });
                    
                    // Search for transcript containers in iframe
                    iframeInfo.transcriptContainers = findTranscriptContainers(iframeDoc);
                }
                
                results.push(iframeInfo);
            } catch (e) {
                results.push({
                    index: idx,
                    id: iframe.id,
                    title: iframe.title,
                    src: iframe.src,
                    accessible: false,
                    error: e.message
                });
            }
        });
        
        return results;
    }
    
    // Main diagnostic
    console.log("1. Searching for known transcript text...");
    knownTranscriptText.forEach(text => {
        const results = findElementsWithText(text);
        if (results.length > 0) {
            console.log(`\n✓ Found: "${text}"`);
            results.forEach((result, idx) => {
                console.log(`  Location ${idx + 1}:`);
                result.path.forEach((element, depth) => {
                    console.log(`    ${"  ".repeat(depth)}${element.tag}${element.id ? '#' + element.id : ''}${element.classes ? '.' + element.classes.replace(/ /g, '.') : ''}`);
                    if (Object.keys(element.dataAttrs).length > 0) {
                        console.log(`    ${"  ".repeat(depth)}Data:`, element.dataAttrs);
                    }
                });
            });
        } else {
            console.log(`✗ Not found: "${text}"`);
        }
    });
    
    console.log("\n2. Searching for common transcript container patterns...");
    const containers = findTranscriptContainers();
    if (containers.length > 0) {
        console.log(`Found ${containers.length} potential transcript containers:`);
        containers.forEach((container, idx) => {
            console.log(`\n  Container ${idx + 1}:`);
            console.log(`    Selector: ${container.selector}`);
            console.log(`    ID: ${container.id || '(none)'}`);
            console.log(`    Classes: ${container.classes || '(none)'}`);
            if (Object.keys(container.dataAttrs).length > 0) {
                console.log(`    Data attributes:`, container.dataAttrs);
            }
            console.log(`    Children: ${container.childCount}`);
            console.log(`    Has content: ${container.hasText}`);
            console.log(`    Element:`, container.element);
        });
    } else {
        console.log("No obvious transcript containers found.");
    }
    
    console.log("\n3. Searching inside iframes...");
    const iframeResults = searchIframes();
    iframeResults.forEach(iframeInfo => {
        console.log(`\n  IFrame ${iframeInfo.index}:`);
        console.log(`    ID: ${iframeInfo.id || '(none)'}`);
        console.log(`    Title: ${iframeInfo.title || '(none)'}`);
        console.log(`    Src: ${iframeInfo.src || '(none)'}`);
        console.log(`    Accessible: ${iframeInfo.accessible}`);
        
        if (iframeInfo.error) {
            console.log(`    ⚠️ Error: ${iframeInfo.error}`);
        }
        
        if (iframeInfo.accessible) {
            if (iframeInfo.knownTextFound.length > 0) {
                console.log(`    ✓ Found ${iframeInfo.knownTextFound.length} known transcript text(s):`);
                iframeInfo.knownTextFound.forEach(found => {
                    console.log(`      - "${found.text}"`);
                    console.log(`        Element:`, found.element);
                });
            } else {
                console.log(`    ✗ No known transcript text found`);
            }
            
            if (iframeInfo.transcriptContainers.length > 0) {
                console.log(`    ✓ Found ${iframeInfo.transcriptContainers.length} potential container(s):`);
                iframeInfo.transcriptContainers.forEach(container => {
                    console.log(`      - ${container.selector}: ${container.id || container.classes}`);
                });
            }
        }
    });
    
    console.log("\n4. Manual inspection suggestions:");
    console.log("   - Look for elements with transcript text in the Elements tab");
    console.log("   - Right-click the transcript text and select 'Inspect'");
    console.log("   - Note the element's classes, IDs, and data attributes");
    console.log("   - Look for parent containers that hold all transcript messages");
    console.log("   - If transcript is in an iframe, you may need to switch context in DevTools");
    
    console.log("\n5. Testing the control:");
    console.log("   To test if your PCF control is working, run this:");
    console.log('   ');
    console.log('   // Copy the TestTranscriptPublisher.js content and run:');
    console.log('   TestTranscriptPublisher.startDemo()');
    
    console.log("\n=== Diagnostic Complete ===");
    
})();
