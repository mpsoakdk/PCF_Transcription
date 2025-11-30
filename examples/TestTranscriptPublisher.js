/**
 * Test Transcript Publisher
 * 
 * Simple script to test the LiveTranscriptControl PCF control
 * Run this in the browser console on the Conversation form
 * 
 * Usage:
 * 1. Open a Conversation record (msdyn_ocsession) in Customer Service workspace
 * 2. Open browser DevTools (F12)
 * 3. Copy and paste this entire script into the console
 * 4. Run: TestTranscriptPublisher.startDemo()
 */

var TestTranscriptPublisher = (function() {
    'use strict';
    
    // Sample conversation data
    const sampleConversation = [
        { speaker: 'Customer', text: 'Hello, I need help with my account.', delay: 0 },
        { speaker: 'Agent', text: 'Hello! I\'d be happy to help you with your account. Can you please provide your account number?', delay: 2000 },
        { speaker: 'Customer', text: 'Sure, it\'s ACC-12345678.', delay: 4000 },
        { speaker: 'Agent', text: 'Thank you. Let me pull up your account information.', delay: 6000 },
        { speaker: 'Agent', text: 'I can see your account here. What specifically would you like help with today?', delay: 8000 },
        { speaker: 'Customer', text: 'I\'m having trouble accessing my recent invoices online.', delay: 10000 },
        { speaker: 'Agent', text: 'I understand. Let me check your account settings. It looks like your online access was recently reset.', delay: 12000 },
        { speaker: 'Agent', text: 'I can send you a password reset link right now. Would that help?', delay: 14000 },
        { speaker: 'Customer', text: 'Yes, that would be great!', delay: 16000 },
        { speaker: 'Agent', text: 'Perfect! I\'ve sent the reset link to your email address on file. You should receive it within a few minutes.', delay: 18000 },
        { speaker: 'Customer', text: 'Thank you so much for your help!', delay: 20000, sentiment: 'positive' },
        { speaker: 'Agent', text: 'You\'re very welcome! Is there anything else I can help you with today?', delay: 22000, sentiment: 'positive' },
        { speaker: 'Customer', text: 'No, that\'s all. Thank you!', delay: 24000 },
        { speaker: 'Agent', text: 'Great! Have a wonderful day, and feel free to reach out if you need any further assistance.', delay: 26000 }
    ];
    
    let conversationId = null;
    let demoInterval = null;
    
    /**
     * Get the conversation ID from the form
     */
    function getConversationId() {
        try {
            // Try different methods to get the conversation ID
            
            // Method 1: From Xrm.Page (legacy)
            if (typeof Xrm !== 'undefined' && Xrm.Page && Xrm.Page.data && Xrm.Page.data.entity) {
                const id = Xrm.Page.data.entity.getId();
                if (id) return id.replace(/[{}]/g, '');
            }
            
            // Method 2: From form context
            if (typeof Xrm !== 'undefined' && Xrm.Page && Xrm.Page.context) {
                const context = Xrm.Page.context;
                if (context.data && context.data.entity) {
                    const id = context.data.entity.getId();
                    if (id) return id.replace(/[{}]/g, '');
                }
            }
            
            // Method 3: From URL
            const urlParams = new URLSearchParams(window.location.search);
            const urlId = urlParams.get('id');
            if (urlId) return urlId.replace(/[{}]/g, '');
            
            // Method 4: Generate a test ID (fallback for console testing)
            // The PCF control now supports "latch-on-first" logic, so any ID will work
            console.warn("Could not determine conversation ID from form. Using test ID.");
            return 'test-conversation-' + Date.now();
            
        } catch (error) {
            console.error("Error getting conversation ID:", error);
            // Return a test ID as fallback
            return 'test-conversation-' + Date.now();
        }
    }
    
    /**
     * Publish a single transcript message
     */
    function publishMessage(speaker, text, timestamp, sentiment) {
        if (!conversationId) {
            conversationId = getConversationId();
        }
        
        const event = new CustomEvent('omnichannelTranscriptUpdate', {
            detail: {
                conversationId: conversationId,
                utterance: {
                    speaker: speaker,
                    text: text,
                    timestamp: timestamp || new Date().toISOString(),
                    sentiment: sentiment
                }
            }
        });
        
        window.dispatchEvent(event);
        console.log(`[Test Publisher] ${speaker}: ${text}`);
    }
    
    /**
     * Publish a single test message immediately
     */
    function publishSingle(speaker, text, sentiment) {
        speaker = speaker || 'Agent';
        text = text || 'This is a test message.';
        
        publishMessage(speaker, text, new Date().toISOString(), sentiment);
    }
    
    /**
     * Start the demo conversation
     */
    function startDemo() {
        console.log("=== Starting Live Transcript Demo ===");
        console.log("Publishing sample conversation to PCF control...");
        
        conversationId = getConversationId();
        
        console.log("Conversation ID:", conversationId);
        console.log("Note: The PCF control will auto-latch to this conversation ID");
        
        // Publish messages with delays
        sampleConversation.forEach(function(message) {
            setTimeout(function() {
                publishMessage(
                    message.speaker,
                    message.text,
                    new Date().toISOString(),
                    message.sentiment
                );
            }, message.delay);
        });
        
        console.log("Demo started! Watch the Live Transcript control for updates.");
        console.log("Demo will complete in approximately 30 seconds.");
    }
    
    /**
     * Start continuous stream simulation
     */
    function startContinuousStream() {
        console.log("=== Starting Continuous Stream ===");
        
        conversationId = getConversationId();
        console.log("Conversation ID:", conversationId);
        
        let messageCount = 0;
        const speakers = ['Agent', 'Customer'];
        
        demoInterval = setInterval(function() {
            const speaker = speakers[messageCount % 2];
            const text = `This is message #${messageCount + 1} from ${speaker}.`;
            
            publishMessage(speaker, text, new Date().toISOString());
            
            messageCount++;
            
            if (messageCount >= 20) {
                stopContinuousStream();
            }
        }, 3000);
        
        console.log("Continuous stream started. Will publish 20 messages.");
    }
    
    /**
     * Stop continuous stream
     */
    function stopContinuousStream() {
        if (demoInterval) {
            clearInterval(demoInterval);
            demoInterval = null;
            console.log("Continuous stream stopped.");
        }
    }
    
    /**
     * Test different speaker types
     */
    function testSpeakers() {
        console.log("=== Testing Different Speakers ===");
        
        conversationId = getConversationId();
        
        publishMessage('Agent', 'Message from Agent', new Date().toISOString());
        
        setTimeout(function() {
            publishMessage('Customer', 'Message from Customer', new Date().toISOString());
        }, 1000);
        
        setTimeout(function() {
            publishMessage('System', 'Message from System', new Date().toISOString());
        }, 2000);
    }
    
    /**
     * Test sentiment indicators
     */
    function testSentiment() {
        console.log("=== Testing Sentiment Indicators ===");
        
        conversationId = getConversationId();
        
        publishMessage('Customer', 'This is a positive message!', new Date().toISOString(), 'positive');
        
        setTimeout(function() {
            publishMessage('Customer', 'This is a neutral message.', new Date().toISOString(), 'neutral');
        }, 1000);
        
        setTimeout(function() {
            publishMessage('Customer', 'This is a negative message.', new Date().toISOString(), 'negative');
        }, 2000);
    }
    
    /**
     * Test long messages and scrolling
     */
    function testLongMessages() {
        console.log("=== Testing Long Messages ===");
        
        conversationId = getConversationId();
        
        const longText = "This is a very long message to test how the control handles lengthy text. " +
                        "It should wrap properly and not break the layout. " +
                        "The transcript control should handle this gracefully and maintain good readability. " +
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor " +
                        "incididunt ut labore et dolore magna aliqua.";
        
        publishMessage('Agent', longText, new Date().toISOString());
        
        setTimeout(function() {
            publishMessage('Customer', 'Short response.', new Date().toISOString());
        }, 1000);
    }
    
    /**
     * Clear conversation (note: this doesn't actually clear the control, just stops publishing)
     */
    function clearTest() {
        stopContinuousStream();
        conversationId = null;
        console.log("Test cleared. Refresh the page to reset the control.");
    }
    
    /**
     * Display help
     */
    function help() {
        console.log("=== Live Transcript Control Test Publisher ===");
        console.log("");
        console.log("Available commands:");
        console.log("  TestTranscriptPublisher.startDemo()              - Run a sample conversation");
        console.log("  TestTranscriptPublisher.startContinuousStream()  - Start continuous message stream");
        console.log("  TestTranscriptPublisher.stopContinuousStream()   - Stop continuous stream");
        console.log("  TestTranscriptPublisher.publishSingle(speaker, text, sentiment) - Publish single message");
        console.log("  TestTranscriptPublisher.testSpeakers()           - Test different speaker types");
        console.log("  TestTranscriptPublisher.testSentiment()          - Test sentiment indicators");
        console.log("  TestTranscriptPublisher.testLongMessages()       - Test long message handling");
        console.log("  TestTranscriptPublisher.clearTest()              - Stop all tests");
        console.log("  TestTranscriptPublisher.help()                   - Show this help");
        console.log("");
        console.log("Examples:");
        console.log("  TestTranscriptPublisher.publishSingle('Agent', 'Hello!')");
        console.log("  TestTranscriptPublisher.publishSingle('Customer', 'Thanks!', 'positive')");
    }
    
    // Public API
    return {
        startDemo: startDemo,
        startContinuousStream: startContinuousStream,
        stopContinuousStream: stopContinuousStream,
        publishSingle: publishSingle,
        testSpeakers: testSpeakers,
        testSentiment: testSentiment,
        testLongMessages: testLongMessages,
        clearTest: clearTest,
        help: help
    };
})();

// Auto-display help on load
console.log("=== Live Transcript Control Test Publisher Loaded ===");
console.log("Type TestTranscriptPublisher.help() for available commands");
console.log("Quick start: TestTranscriptPublisher.startDemo()");
