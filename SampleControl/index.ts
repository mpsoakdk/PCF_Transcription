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
export class LiveTranscriptControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    
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
    private _transcriptUtterances: TranscriptUtterance[] = [];
    private _isActive: boolean = false;
    
    // Event handlers (stored for cleanup)
    private _customEventHandler: ((event: Event) => void) | null = null;
    private _postMessageHandler: ((event: MessageEvent) => void) | null = null;
    
    // Polling (fallback mechanism)
    private _pollingInterval: number | null = null;
    private _pollingIntervalMs: number = 5000; // 5 seconds
    
    /**
     * Constructor
     */
    constructor() {
        // Empty constructor as per PCF standards
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
        
        console.log("[LiveTranscriptControl] Initialized for conversation:", this._conversationId);
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
        
        console.log("[LiveTranscriptControl] Subscribed to transcript events");
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
        
        // Validate that this event is for the current conversation
        if (!data || data.conversationId !== this._conversationId) {
            return;
        }
        
        console.log("[LiveTranscriptControl] Received transcript event:", data);
        
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
        
        // Validate that this message is for the current conversation
        if (data.conversationId !== this._conversationId) {
            return;
        }
        
        console.log("[LiveTranscriptControl] Received postMessage transcript:", data);
        
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
        
        console.log("[LiveTranscriptControl] Starting polling (NOTE: Only retrieves post-call transcripts)");
        
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
            console.error("[LiveTranscriptControl] Error polling for transcripts:", error);
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
            console.log("[LiveTranscriptControl] Polling stopped");
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
        
        console.log("[LiveTranscriptControl] Unsubscribed from transcript events");
    }

    /**
     * Called when any value in the property bag has changed
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
        
        // Check if conversation ID has changed
        const newConversationId = context.parameters.conversationId.raw;
        if (newConversationId !== this._conversationId) {
            console.log("[LiveTranscriptControl] Conversation changed:", this._conversationId, "->", newConversationId);
            
            // Reset the control for the new conversation
            this._conversationId = newConversationId;
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
        
        // Reset state
        this._isActive = false;
        this._statusMessage.style.display = "block";
        this._statusMessage.textContent = "Waiting for live voice transcription...";
        this.updateConnectionStatus("Listening");
        
        console.log("[LiveTranscriptControl] Transcript reset for conversation:", this._conversationId);
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
        
        console.log("[LiveTranscriptControl] Destroyed");
    }
}
