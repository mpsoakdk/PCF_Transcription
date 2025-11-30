import { IInputs, IOutputs } from "./generated/ManifestTypes";

/**
 * Interface representing a single transcript utterance
 */
interface TranscriptUtterance {
    id: string;
    speaker: string; // "Agent" or "Customer"
    text: string;
    timestamp: Date;
    sentiment?: string; // Optional sentiment indicator
}

/**
 * Interface for transcript events from Omnichannel workspace
 * This is the expected format if Microsoft exposes transcript events in the future
 */
interface OmnichannelTranscriptEvent {
    conversationId: string;
    utterance: {
        speaker: string;
        text: string;
        timestamp: string;
        sentiment?: string;
    };
}

/**
 * LiveTranscriptControl - PCF Control for displaying live voice transcription
 * in Dynamics 365 Customer Service workspace for voice calls (msdyn_ocsession)
 * 
 * IMPORTANT IMPLEMENTATION NOTES:
 * ================================
 * As of November 2025, Microsoft does not expose public APIs for accessing live
 * voice transcription events from within PCF controls. This implementation provides
 * three integration approaches:
 * 
 * 1. CUSTOM EVENT LISTENER (Recommended for production with workspace customization)
 *    - Listens for custom 'omnichannelTranscriptUpdate' events on window
 *    - Requires workspace-level customization to publish these events
 *    - See deployment documentation for details on event publishing
 * 
 * 2. WINDOW.POSTMESSAGE (Alternative approach)
 *    - Listens for postMessage events from the workspace shell
 *    - Can be used with custom workspace scripts or browser extensions
 * 
 * 3. POLLING FALLBACK (Development/Testing)
 *    - Polls for transcript data via WebAPI
 *    - NOTE: msdyn_transcript records are only created AFTER call ends
 *    - This approach will NOT show live transcription during active calls
 *    - Included for completeness and testing scenarios
 * 
 * TO ENABLE LIVE TRANSCRIPTION:
 * =============================
 * You must implement one of the following:
 * 
 * Option A: Custom Workspace Script (Recommended)
 * ------------------------------------------------
 * Create a web resource that monitors the Omnichannel conversation panel
 * and publishes transcript events. Example:
 * 
 * // In your custom workspace web resource:
 * function publishTranscriptUpdate(conversationId, speaker, text, timestamp) {
 *     const event = new CustomEvent('omnichannelTranscriptUpdate', {
 *         detail: {
 *             conversationId: conversationId,
 *             utterance: {
 *                 speaker: speaker,
 *                 text: text,
 *                 timestamp: timestamp
 *             }
 *         }
 *     });
 *     window.dispatchEvent(event);
 * }
 * 
 * Option B: Microsoft Omnichannel API (When Available)
 * -----------------------------------------------------
 * Monitor Microsoft documentation for future APIs:
 * - Microsoft.Omnichannel namespace
 * - Customer Service workspace extensibility APIs
 * - Real-time conversation events
 * 
 * Option C: Direct DOM Observation (Not Recommended)
 * ---------------------------------------------------
 * Use MutationObserver to watch the Omnichannel transcript panel DOM
 * This is fragile and not recommended for production
 */
export class TranscriptViewer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    
    // Core properties
    private _context: ComponentFramework.Context<IInputs>;
    private _container: HTMLDivElement;
    private _notifyOutputChanged: () => void;
    
    // UI Elements
    private _transcriptContainer: HTMLDivElement;
    private _transcriptList: HTMLDivElement;
    private _statusMessage: HTMLDivElement;
    private _headerElement: HTMLDivElement;
    
    // State
    private _conversationId: string | null = null;
    private _sessionlessId: string | null = null; // fallback when no GUID is available yet
    private _transcriptUtterances: TranscriptUtterance[] = [];
    private _isActive: boolean = false;
    private _processedArticles: Set<Element> = new Set();
    
    // Event handlers (stored for cleanup)
    private _customEventHandler: ((event: Event) => void) | null = null;
    private _postMessageHandler: ((event: MessageEvent) => void) | null = null;
    
    // Polling (fallback mechanism)
    private _pollingInterval: number | null = null;
    private _pollingIntervalMs: number = 5000; // 5 seconds
    
    // MutationObserver for iframe monitoring
    private _transcriptObserver: MutationObserver | null = null;
    private _articleCheckInterval: number | null = null;
    
    /**
     * Constructor
     */
    constructor() {
        // Empty constructor as per PCF standards
    }
    
    /**
     * Get the conversation iframe (#SidePanelIFrame)
     * Returns the outer iframe that contains the Omnichannel widgets
     */
    private getConversationIFrame(): HTMLIFrameElement | null {
        const iframe = document.querySelector<HTMLIFrameElement>('#SidePanelIFrame');
        if (!iframe) {
            console.log("[TranscriptViewer] Could not find #SidePanelIFrame");
            return null;
        }
        return iframe;
    }
    
    /**
     * Get the Omnichannel iframe (nested inside conversation iframe)
     * Returns the inner iframe that contains the webchat transcript
     */
    private getOmnichannelIFrame(conversationIFrame: HTMLIFrameElement): HTMLIFrameElement | null {
        try {
            const iframeDoc = conversationIFrame.contentDocument || conversationIFrame.contentWindow?.document;
            if (!iframeDoc) {
                console.log("[TranscriptViewer] Cannot access conversation iframe document");
                return null;
            }
            
            const omnichannelIframe = iframeDoc.querySelector<HTMLIFrameElement>('iframe[title="Omnichannel"]');
            if (!omnichannelIframe) {
                console.log("[TranscriptViewer] Could not find Omnichannel iframe");
                return null;
            }
            
            return omnichannelIframe;
        } catch (err) {
            console.error("[TranscriptViewer] Error accessing conversation iframe:", err);
            return null;
        }
    }
    
    /**
     * Search for transcript articles in the Omnichannel iframe
     * Returns array of article elements containing webchat transcript messages
     */
    private searchIFrameForTranscript(omnichannelIFrame: HTMLIFrameElement): Element[] {
        try {
            const iframeDoc = omnichannelIFrame.contentDocument || omnichannelIFrame.contentWindow?.document;
            if (!iframeDoc) {
                console.log("[TranscriptViewer] Cannot access Omnichannel iframe document");
                return [];
            }
            
            const articles = iframeDoc.querySelectorAll('article.webchat__basic-transcript__activity');
            console.log(`[TranscriptViewer] Found ${articles.length} transcript articles`);
            
            return Array.from(articles);
        } catch (err) {
            console.error("[TranscriptViewer] Error searching iframe for transcript:", err);
            return [];
        }
    }
    
    /**
     * Start monitoring the nested iframe for new transcript messages
     * Uses MutationObserver to detect when new article elements are added
     */
    private startIFrameMonitoring(): void {
        console.log("[TranscriptViewer] Starting iframe monitoring...");
        
        // Get the outer iframe
        const conversationIFrame = this.getConversationIFrame();
        if (!conversationIFrame) {
            console.warn("[TranscriptViewer] Cannot start monitoring - conversation iframe not found");
            // Retry after delay
            setTimeout(() => this.startIFrameMonitoring(), 2000);
            return;
        }
        
        // Get the nested Omnichannel iframe
        const omnichannelIFrame = this.getOmnichannelIFrame(conversationIFrame);
        if (!omnichannelIFrame) {
            console.warn("[TranscriptViewer] Cannot start monitoring - Omnichannel iframe not found");
            // Retry after delay
            setTimeout(() => this.startIFrameMonitoring(), 2000);
            return;
        }
        
        // Access the Omnichannel iframe's document
        const iframeDoc = omnichannelIFrame.contentDocument || omnichannelIFrame.contentWindow?.document;
        if (!iframeDoc) {
            console.error("[TranscriptViewer] Cannot access Omnichannel iframe document");
            return;
        }
        
        console.log("[TranscriptViewer] ✅ Found Omnichannel iframe, starting MutationObserver");
        
        // Create MutationObserver to watch for new transcript articles AND changes within them
        this._transcriptObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                // Check for new article elements being added
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof Element) {
                        // Check if this node is an article
                        if (node.matches('article.webchat__basic-transcript__activity')) {
                            console.log("[TranscriptViewer] 🆕 New article element detected");
                            this.processTranscriptArticle(node);
                        }
                        // Also check if article elements are being added as descendants
                        const nestedArticles = node.querySelectorAll('article.webchat__basic-transcript__activity');
                        nestedArticles.forEach(article => {
                            console.log("[TranscriptViewer] 🆕 New nested article detected");
                            this.processTranscriptArticle(article);
                        });
                    }
                });
                
                // IMPORTANT: Also check if content is added to existing articles
                // This handles the case where the article exists but message content is added later
                if (mutation.target instanceof Element) {
                    const targetArticle = mutation.target.closest('article.webchat__basic-transcript__activity');
                    if (targetArticle && !this._processedArticles.has(targetArticle)) {
                        // Check if this article now has content
                        const messageElement = targetArticle.querySelector('.webchat__render-markdown div');
                        if (messageElement && messageElement.textContent?.trim()) {
                            console.log("[TranscriptViewer] 📝 Content added to existing article");
                            this.processTranscriptArticle(targetArticle);
                        }
                    }
                }
            });
        });
        
        // Start observing the iframe document body
        this._transcriptObserver.observe(iframeDoc.body, {
            childList: true,
            subtree: true,
            characterData: true,
            characterDataOldValue: false
        });
        
        this.updateConnectionStatus("Live (Monitoring iframe)");
        console.log("[TranscriptViewer] 🎤 Monitoring started - watching for new transcript messages");
        
        // Process any existing articles
        const existingArticles = this.searchIFrameForTranscript(omnichannelIFrame);
        console.log(`[TranscriptViewer] Processing ${existingArticles.length} existing articles`);
        existingArticles.forEach(article => this.processTranscriptArticle(article));
        
        // FALLBACK: Poll for new articles every 500ms in case MutationObserver misses them
        // This is a safety net for virtual scrolling or dynamic rendering
        this._articleCheckInterval = window.setInterval(() => {
            const currentArticles = this.searchIFrameForTranscript(omnichannelIFrame);
            currentArticles.forEach(article => {
                if (!this._processedArticles.has(article)) {
                    console.log("[TranscriptViewer] 🔄 Polling found unprocessed article");
                    this.processTranscriptArticle(article);
                }
            });
        }, 500);
    }
    
    /**
     * Process a transcript article element
     * Extracts speaker and text, then adds to transcript display
     */
    private processTranscriptArticle(article: Element): void {
        try {
            // Check if we've already processed this article
            if (this._processedArticles.has(article)) {
                console.log("[TranscriptViewer] ⏭️ Skipping already processed article");
                return; // Skip duplicates
            }
            
            console.log("[TranscriptViewer] 🔍 Processing article element:", article);
            
            // Extract sender (speaker) - try multiple selectors
            let senderElement = article.querySelector('.webchat--css-wwipp-111jw2m');
            if (!senderElement) {
                senderElement = article.querySelector('[class*="sender"]');
            }
            if (!senderElement) {
                senderElement = article.querySelector('[class*="from"]');
            }
            if (!senderElement) {
                // Try to find any element that might contain sender info
                senderElement = article.querySelector('[aria-label*="from"], [aria-label*="said"]');
            }
            
            let sender = senderElement?.textContent?.trim() || "";
            
            // If still no sender, check aria-label on the article itself
            if (!sender) {
                const ariaLabel = article.getAttribute('aria-label');
                if (ariaLabel) {
                    // Extract sender from aria-label like "Bot CU said: message text"
                    const match = ariaLabel.match(/^(.+?)\s+said:/i);
                    if (match) {
                        sender = match[1].trim();
                    }
                }
            }
            
            // If still no sender, check data attributes
            if (!sender) {
                sender = article.getAttribute('data-sender') || 
                         article.getAttribute('data-from') || 
                         "Unknown";
            }
            
            console.log(`[TranscriptViewer]   Sender found: "${sender}"`);
            console.log(`[TranscriptViewer]   Sender element:`, senderElement);
            
            // Extract message text
            let messageElement = article.querySelector('.webchat__render-markdown div');
            if (!messageElement) {
                messageElement = article.querySelector('.webchat__text-content__markdown');
            }
            if (!messageElement) {
                messageElement = article.querySelector('[class*="message"], [class*="text"]');
            }
            
            const text = messageElement?.textContent?.trim() || "";
            console.log(`[TranscriptViewer]   Text: "${text}"`);
            
            if (text) {
                // Mark as processed
                this._processedArticles.add(article);
                
                console.log(`[TranscriptViewer] 📝 New message: [${sender}] ${text}`);
                
                // Map sender names to our format
                let speaker = "Unknown";
                const senderLower = sender.toLowerCase();
                
                if (senderLower.includes("bot") || senderLower.includes("cu") || senderLower.includes("agent")) {
                    speaker = "Agent";
                } else if (senderLower.includes("you") || senderLower.includes("customer") || senderLower.includes("caller")) {
                    speaker = "Customer";
                } else if (sender && sender !== "Unknown") {
                    // If we have a sender name but it doesn't match patterns, assume it's the customer
                    speaker = "Customer";
                }
                
                // Add to transcript
                this.addUtterance(speaker, text, new Date());
                console.log(`[TranscriptViewer] ✅ Added to UI as speaker: ${speaker} (from: ${sender})`);
            } else {
                console.log("[TranscriptViewer] ⚠️ Article has no text content, skipping");
            }
        } catch (err) {
            console.error("[TranscriptViewer] Error processing transcript article:", err);
        }
    }
    
    /**
     * Stop iframe monitoring
     */
    private stopIFrameMonitoring(): void {
        if (this._transcriptObserver) {
            this._transcriptObserver.disconnect();
            this._transcriptObserver = null;
            console.log("[TranscriptViewer] Iframe monitoring stopped");
        }
        
        if (this._articleCheckInterval) {
            window.clearInterval(this._articleCheckInterval);
            this._articleCheckInterval = null;
            console.log("[TranscriptViewer] Article polling stopped");
        }
    }

    /**
     * Initialize the control instance
     */
    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this._context = context;
        this._container = container;
        this._notifyOutputChanged = notifyOutputChanged;
        
        // Get conversation ID from bound property
        this._conversationId = context.parameters.conversationId.raw;
        
        // Build the UI
        this.createUI();
        
        // Subscribe to transcript events
        this.subscribeToTranscriptEvents();
        
        // Start iframe monitoring for live transcripts
        this.startIFrameMonitoring();
        
        if (!this._conversationId) {
            // New conversations may not have a GUID yet; operate in sessionless mode
            this._sessionlessId = `sessionless-${Date.now()}`;
            this.updateConnectionStatus("Listening (no conversation ID yet)");
            console.warn("[TranscriptViewer] No conversationId provided. Running in sessionless mode:", this._sessionlessId);
        }

        console.log("[TranscriptViewer] Initialized for conversation:", this._conversationId ?? this._sessionlessId);
    }

    /**
     * Create the UI structure
     */
    private createUI(): void {
        // Main container
        this._transcriptContainer = document.createElement("div");
        this._transcriptContainer.className = "live-transcript-control";
        
        // Get max height from parameters
        const maxHeight = this._context.parameters.maxHeight.raw || 400;
        this._transcriptContainer.style.maxHeight = `${maxHeight}px`;
        
        // Header
        this._headerElement = document.createElement("div");
        this._headerElement.className = "transcript-header";
        this._headerElement.innerHTML = `
            <span class="header-title">📞 Live Transcript</span>
            <span class="header-status" id="connectionStatus">Connecting...</span>
        `;
        this._transcriptContainer.appendChild(this._headerElement);
        
        // Status message (for when no call is active)
        this._statusMessage = document.createElement("div");
        this._statusMessage.className = "transcript-status-message";
        this._statusMessage.textContent = "Waiting for live voice transcription...";
        this._transcriptContainer.appendChild(this._statusMessage);
        
        // Transcript list
        this._transcriptList = document.createElement("div");
        this._transcriptList.className = "transcript-list";
        this._transcriptContainer.appendChild(this._transcriptList);
        
        // Add to container
        this._container.appendChild(this._transcriptContainer);
    }

    /**
     * Subscribe to transcript events from various sources
     * 
     * INTEGRATION POINT: This is where the control listens for transcript updates
     */
    private subscribeToTranscriptEvents(): void {
        // METHOD 1: Custom event listener for workspace-published events
        this._customEventHandler = this.handleCustomTranscriptEvent.bind(this);
        window.addEventListener('omnichannelTranscriptUpdate', this._customEventHandler as EventListener);
        
        // METHOD 2: PostMessage listener (alternative integration)
        this._postMessageHandler = this.handlePostMessage.bind(this);
        window.addEventListener('message', this._postMessageHandler as EventListener);
        
        // METHOD 3: Polling fallback (will only work after call ends)
        // Uncomment the following line to enable polling:
        // this.startPolling();
        
        this.updateConnectionStatus("Listening for transcript events");
        
        console.log("[TranscriptViewer] Subscribed to transcript events");
        console.log("Integration methods:");
        console.log("  1. Custom events: window.dispatchEvent('omnichannelTranscriptUpdate')");
        console.log("  2. PostMessage: window.postMessage({ type: 'transcriptUpdate', ... })");
        console.log("  3. Polling: Currently disabled (enable in subscribeToTranscriptEvents)");
    }

    /**
     * Handle custom transcript events
     * 
     * EXPECTED EVENT FORMAT:
     * {
     *   detail: {
     *     conversationId: "guid",
     *     utterance: {
     *       speaker: "Agent" | "Customer",
     *       text: "utterance text",
     *       timestamp: "ISO datetime string",
     *       sentiment: "positive" | "neutral" | "negative" (optional)
     *     }
     *   }
     * }
     */
    private handleCustomTranscriptEvent(event: Event): void {
        const customEvent = event as CustomEvent<OmnichannelTranscriptEvent>;
        const data = customEvent.detail;
        
        if (!data) {
            return;
        }
        
        const incomingId = data.conversationId;

        // If we have an incoming ID, adopt it; otherwise operate in sessionless mode
        if (!this._conversationId && incomingId) {
            this._conversationId = incomingId;
            console.log("[LiveTranscriptControl] Latched onto conversation ID:", incomingId);
            this.updateConnectionStatus("Live");
        } else if (!this._conversationId && !this._sessionlessId) {
            this._sessionlessId = `sessionless-${Date.now()}`;
            console.warn("[LiveTranscriptControl] No conversationId on event; using sessionless ID:", this._sessionlessId);
            this.updateConnectionStatus("Live (no conversation ID)");
        }

        // If both IDs exist and do not match, log but still accept to avoid blocking sessionless usage
        if (this._conversationId && incomingId && incomingId !== this._conversationId) {
            console.warn("[LiveTranscriptControl] Incoming event for different conversationId. Accepting because sessionless mode is allowed.", incomingId, this._conversationId);
        }

        console.log("[TranscriptViewer] Received transcript event:", data);
        
        // Add the utterance
        this.addUtterance(
            data.utterance.speaker,
            data.utterance.text,
            new Date(data.utterance.timestamp),
            data.utterance.sentiment
        );
    }

    /**
     * Handle postMessage events
     * 
     * EXPECTED MESSAGE FORMAT:
     * {
     *   type: "omnichannelTranscriptUpdate",
     *   conversationId: "guid",
     *   speaker: "Agent" | "Customer",
     *   text: "utterance text",
     *   timestamp: "ISO datetime string",
     *   sentiment: "positive" | "neutral" | "negative" (optional)
     * }
     */
    private handlePostMessage(event: MessageEvent): void {
        // Validate origin if needed (security consideration)
        // if (event.origin !== "expected-origin") return;
        
        const data = event.data;
        
        if (data.type !== "omnichannelTranscriptUpdate") {
            return;
        }
        
        const incomingId = data.conversationId;

        // If no Conversation ID was provided, latch onto the first incoming ID or create a sessionless placeholder
        if (!this._conversationId && incomingId) {
            this._conversationId = incomingId;
            console.log("[TranscriptViewer] Latched onto conversation ID:", incomingId);
            this.updateConnectionStatus("Live");
        } else if (!this._conversationId && !this._sessionlessId) {
            this._sessionlessId = `sessionless-${Date.now()}`;
            console.warn("[TranscriptViewer] No conversationId on postMessage; using sessionless ID:", this._sessionlessId);
            this.updateConnectionStatus("Live (no conversation ID)");
        }

        // If both IDs exist and do not match, do not block; just log for awareness
        if (this._conversationId && incomingId && incomingId !== this._conversationId) {
            console.warn("[TranscriptViewer] Received transcript for different conversationId. Accepting because sessionless mode is allowed.", incomingId, this._conversationId);
        }

        console.log("[TranscriptViewer] Received postMessage transcript:", data);
        
        // Add the utterance
        this.addUtterance(
            data.speaker,
            data.text,
            new Date(data.timestamp),
            data.sentiment
        );
    }

    /**
     * Start polling for transcript data (FALLBACK - only works after call ends)
     * 
     * NOTE: This method polls the msdyn_transcript table, which is only populated
     * AFTER the voice call ends. It will NOT show live transcription during active calls.
     * This is included for testing and as a fallback mechanism.
     */
    private startPolling(): void {
        if (this._pollingInterval !== null) {
            return; // Already polling
        }
        
        console.log("[TranscriptViewer] Starting polling (NOTE: Only retrieves post-call transcripts)");
        
        // Poll immediately, then at intervals
        this.pollForTranscripts();
        
        this._pollingInterval = window.setInterval(() => {
            this.pollForTranscripts();
        }, this._pollingIntervalMs);
    }

    /**
     * Poll for transcript records via WebAPI
     * 
     * LIMITATION: msdyn_transcript records are created AFTER call completion,
     * so this will not provide live transcription during an active call.
     */
    private async pollForTranscripts(): Promise<void> {
        if (!this._conversationId) {
            return;
        }
        
        try {
            // Query for transcript records related to this conversation
            // Note: Adjust the query based on actual schema relationships
            const query = `msdyn_transcripts?$filter=_msdyn_conversationid_value eq ${this._conversationId}&$orderby=createdon asc`;
            
            const result = await this._context.webAPI.retrieveMultipleRecords("msdyn_transcript", query);
            
            if (result.entities && result.entities.length > 0) {
                // Process transcript records
                result.entities.forEach((transcript: any) => {
                    // Check if we already have this utterance
                    const existingUtterance = this._transcriptUtterances.find(u => u.id === transcript.msdyn_transcriptid);
                    
                    if (!existingUtterance) {
                        // Add new utterance
                        // Note: Adjust field names based on actual msdyn_transcript schema
                        this.addUtterance(
                            transcript.msdyn_speaker || "Unknown",
                            transcript.msdyn_text || "",
                            new Date(transcript.createdon),
                            transcript.msdyn_sentiment,
                            transcript.msdyn_transcriptid
                        );
                    }
                });
                
                this._isActive = true;
                this._statusMessage.style.display = "none";
                this.updateConnectionStatus("Live (Polling)");
            }
        } catch (error) {
            console.error("[TranscriptViewer] Error polling for transcripts:", error);
            this.updateConnectionStatus("Error polling transcripts");
        }
    }

    /**
     * Add a new utterance to the transcript
     */
    private addUtterance(
        speaker: string,
        text: string,
        timestamp: Date,
        sentiment?: string,
        id?: string
    ): void {
        // Generate ID if not provided
        const utteranceId = id || `utterance-${Date.now()}-${Math.random()}`;
        
        // Create utterance object
        const utterance: TranscriptUtterance = {
            id: utteranceId,
            speaker: speaker,
            text: text,
            timestamp: timestamp,
            sentiment: sentiment
        };
        
        // Add to array
        this._transcriptUtterances.push(utterance);
        
        // Render the utterance
        this.renderUtterance(utterance);
        
        // Update UI state
        if (!this._isActive) {
            this._isActive = true;
            this._statusMessage.style.display = "none";
            this.updateConnectionStatus("Live");
        }
        
        // Auto-scroll to bottom
        this.scrollToBottom();
    }

    /**
     * Render a single utterance in the UI
     */
    private renderUtterance(utterance: TranscriptUtterance): void {
        const utteranceElement = document.createElement("div");
        utteranceElement.className = `transcript-utterance ${utterance.speaker.toLowerCase()}`;
        utteranceElement.setAttribute("data-utterance-id", utterance.id);
        
        // Add sentiment class if available
        if (utterance.sentiment) {
            utteranceElement.classList.add(`sentiment-${utterance.sentiment.toLowerCase()}`);
        }
        
        // Format timestamp
        const timeString = utterance.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
        
        utteranceElement.innerHTML = `
            <div class="utterance-header">
                <span class="speaker">${this.escapeHtml(utterance.speaker)}</span>
                <span class="timestamp">${timeString}</span>
            </div>
            <div class="utterance-text">${this.escapeHtml(utterance.text)}</div>
        `;
        
        this._transcriptList.appendChild(utteranceElement);
    }

    /**
     * Scroll the transcript to the bottom
     */
    private scrollToBottom(): void {
        this._transcriptList.scrollTop = this._transcriptList.scrollHeight;
    }

    /**
     * Update the connection status indicator
     */
    private updateConnectionStatus(status: string): void {
        const statusElement = this._headerElement.querySelector("#connectionStatus");
        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Stop polling
     */
    private stopPolling(): void {
        if (this._pollingInterval !== null) {
            window.clearInterval(this._pollingInterval);
            this._pollingInterval = null;
            console.log("[TranscriptViewer] Polling stopped");
        }
    }

    /**
     * Unsubscribe from all transcript events
     */
    private unsubscribeFromTranscriptEvents(): void {
        // Remove custom event listener
        if (this._customEventHandler) {
            window.removeEventListener('omnichannelTranscriptUpdate', this._customEventHandler as EventListener);
            this._customEventHandler = null;
        }
        
        // Remove postMessage listener
        if (this._postMessageHandler) {
            window.removeEventListener('message', this._postMessageHandler as EventListener);
            this._postMessageHandler = null;
        }
        
        // Stop polling
        this.stopPolling();
        
        console.log("[TranscriptViewer] Unsubscribed from transcript events");
    }

    /**
     * Called when any value in the property bag has changed
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
        
        // Check if conversation ID has changed
        const newConversationId = context.parameters.conversationId.raw;
        if (newConversationId !== this._conversationId) {
            console.log("[TranscriptViewer] Conversation changed:", this._conversationId, "->", newConversationId);
            
            // Reset the control for the new conversation
            this._conversationId = newConversationId;
            if (!this._conversationId) {
                this._sessionlessId = `sessionless-${Date.now()}`;
                this.updateConnectionStatus("Listening (no conversation ID yet)");
                console.warn("[TranscriptViewer] Conversation cleared; using new sessionless ID:", this._sessionlessId);
            }
            this.resetTranscript();
        }
    }

    /**
     * Reset the transcript display
     */
    private resetTranscript(): void {
        // Clear utterances
        this._transcriptUtterances = [];
        this._transcriptList.innerHTML = "";
        this._processedArticles.clear();
        
        // Reset state
        this._isActive = false;
        this._statusMessage.style.display = "block";
        this._statusMessage.textContent = "Waiting for live voice transcription...";
        this.updateConnectionStatus("Listening");
        
        console.log("[TranscriptViewer] Transcript reset for conversation:", this._conversationId);
    }

    /**
     * Get outputs (not used in this control)
     */
    public getOutputs(): IOutputs {
        return {};
    }

    /**
     * Cleanup when control is removed from DOM
     */
    public destroy(): void {
        // Unsubscribe from all events
        this.unsubscribeFromTranscriptEvents();
        
        // Stop iframe monitoring
        this.stopIFrameMonitoring();
        
        console.log("[TranscriptViewer] Destroyed");
    }
}
