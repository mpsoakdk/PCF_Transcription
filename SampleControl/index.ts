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
 * Interface for AI chat messages
 */
interface AIChatMessage {
    id: string;
    sender: "user" | "ai";
    text: string;
    timestamp: Date;
}

/**
 * Interface for suggested actions
 */
interface SuggestedAction {
    id: string;
    title: string;
    description: string;
    icon: string;
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
    
    // UI Elements - Main Layout
    private _mainContainer: HTMLDivElement;
    private _transcriptContainer: HTMLDivElement;
    private _transcriptList: HTMLDivElement;
    private _statusMessage: HTMLDivElement;
    private _headerElement: HTMLDivElement;
    
    // UI Elements - AI Chat (Column 2)
    private _aiChatContainer: HTMLDivElement;
    private _aiChatMessagesContainer: HTMLDivElement;
    private _aiChatInput: HTMLInputElement;
    
    // UI Elements - Info Panel (Column 3)
    private _infoPanelContainer: HTMLDivElement;
    private _guestInfoPanel: HTMLDivElement;
    private _actionsPanel: HTMLDivElement;
    
    // State
    private _conversationId: string | null = null;
    private _sessionlessId: string | null = null; // fallback when no GUID is available yet
    private _transcriptUtterances: TranscriptUtterance[] = [];
    private _isActive: boolean = false;
    private _processedArticles: Set<Element> = new Set();
    
    // AI Chat State
    private _aiChatMessages: AIChatMessage[] = [];
    
    // Guest Info State (placeholder data)
    private _guestInfo = {
        name: "Loading...",
        room: "---",
        checkIn: "---",
        checkOut: "---",
        phone: "---",
        email: "---",
        loyalty: "---",
        preferences: "---",
        notes: "---"
    };
    
    // Current user name (Customer Service Employee)
    private _currentUserName: string = "Agent";
    
    // Conversation title
    private _conversationTitle: string = "Guest Inquiry";
    
    // Live Transcript visibility
    private _isTranscriptVisible: boolean = false;
    private _toggleTranscriptButton: HTMLButtonElement | null = null;
    
    // Toast notification container
    private _toastContainer: HTMLDivElement | null = null;
    
    // Azure AI configuration
    private _azureOpenAIEndpoint: string | null = null;
    private _azureOpenAIKey: string | null = null;
    private _azureOpenAIDeployment: string = "gpt-4o-mini";
    private _conversationHistory: Array<{role: string, content: string}> = [];
    private _systemPrompt: string = `Rolle
Du er en AI-assistent til Munkebjerg Hotels kundeserviceteam. Du hjælper hotellets medarbejdere med at yde fremragende service ved at analysere live samtaleudskrifter og give realtidsindsigt.

Konversationsformat (VIGTIGT - brug altid denne struktur):

### 📋 Samtaleoversigt
[2-3 sætninger om hvad der er diskuteret indtil nu]

### 🎯 Gæstens behov
[Hvad ønsker gæsten]

### ✅ Foreslåede handlinger
- [Konkret handling 1 - f.eks. "Bekræft værelsesnummer"]
- [Konkret handling 2 - f.eks. "Tjek tilgængelighed i systemet"]
- [Konkret handling 3 - f.eks. "Tilbyd opgradering"]

### 💬 Hurtigt svar til gæsten
"[Skriv et konkret svar som medarbejderen kan bruge direkte]"

### ❓ Manglende information
- [Hvad mangler vi at vide - f.eks. "Værelsesnummer"]
- [Andet manglende - f.eks. "Ankomsttidspunkt"]
- [Præferencer - f.eks. "Diætbehov"]

### 📌 Vigtige noter
[Special krav, loyalitetsstatus (Gold/Silver/Bronze), sentiment]

Hotel kontekst: Munkebjerg Hotel - Luksushotel i Danmark med roomservice, rengøring, bookingændringer, loyalitetsprogram

Regler:
- Skriv ALTID på dansk
- Brug strukturen ovenfor i HVER besked
- Hold svar under 250 ord
- Vær konkret og handlingsorienteret
- Prioritér gæstetilfredshed`;
    
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
                // Mike Poulsen / Customer Service Employee = Customer (the guest)
                // Actual customer / Unknown / You = Agent (hotel staff)
                let speaker = "Agent"; // Default to Agent (hotel staff)
                const senderLower = sender.toLowerCase();
                
                if (senderLower.includes("customer") || senderLower.includes("mike") || senderLower.includes("poulsen") || senderLower.includes("bot") || senderLower.includes("cu")) {
                    // Mike Poulsen or Customer Service Employee = Customer (the guest)
                    speaker = "Customer";
                } else if (senderLower.includes("unknown") || senderLower.includes("you") || senderLower.includes("caller") || senderLower.includes("guest")) {
                    // Unknown or You = Agent (hotel staff)
                    speaker = "Agent";
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
        
        // Get current user name
        this.getCurrentUserName();
        
        // Build the UI
        this.createUI();
        
        // Subscribe to transcript events
        this.subscribeToTranscriptEvents();
        
        // Start iframe monitoring for live transcripts
        this.startIFrameMonitoring();
        
        // Load placeholder guest data
        this._guestInfo = {
            name: "John Anderson",
            room: "305",
            checkIn: "Nov 28, 2025",
            checkOut: "Dec 2, 2025",
            phone: "+45 1234 5678",
            email: "j.anderson@email.com",
            loyalty: "Gold Member",
            preferences: "Non-smoking, High floor, Extra pillows",
            notes: "Regular guest, prefers room with city view"
        };
        this.renderGuestInfo();
        
        // Auto-configure Azure Foundry
        this.configureAzureFoundry(
            "https://hoterlmunkbjergdemo.cognitiveservices.azure.com",
            "Bgrk12N01obBxT9OdDuH6vnbLFZ5EPXulvwW4XEJ80BbSY98aEyIJQQJ99BKACfhMk5XJ3w3AAAAACOGWjpS",
            "gpt-4o-mini"
        ).catch(err => console.error("[TranscriptViewer] Failed to configure Azure AI:", err));
        
        if (!this._conversationId) {
            // New conversations may not have a GUID yet; operate in sessionless mode
            this._sessionlessId = `sessionless-${Date.now()}`;
            this.updateConnectionStatus("Listening (no conversation ID yet)");
            console.warn("[TranscriptViewer] No conversationId provided. Running in sessionless mode:", this._sessionlessId);
        }

        console.log("[TranscriptViewer] Initialized for conversation:", this._conversationId ?? this._sessionlessId);
    }

    /**
     * Create the UI structure - 3 column layout
     */
    private createUI(): void {
        // Main container with 3-column grid
        this._mainContainer = document.createElement("div");
        this._mainContainer.className = "hotel-reception-assistant";
        
        // Get max height from parameters
        const maxHeight = this._context.parameters.maxHeight.raw || 600;
        this._mainContainer.style.height = `${maxHeight}px`;
        
        // Add transcript-hidden class by default
        this._mainContainer.classList.add("transcript-hidden");
        
        // Create toast container
        this._toastContainer = document.createElement("div");
        this._toastContainer.className = "toast-container";
        this._mainContainer.appendChild(this._toastContainer);
        
        // === COLUMN 1: Transcript History ===
        this.createTranscriptColumn();
        
        // === COLUMN 2: AI Chat ===
        this.createAIChatColumn();
        
        // === COLUMN 3: Guest Info + Actions ===
        this.createInfoColumn();
        
        // Add to container
        this._container.appendChild(this._mainContainer);
    }
    
    /**
     * Create Column 1: Transcript History
     */
    private createTranscriptColumn(): void {
        this._transcriptContainer = document.createElement("div");
        this._transcriptContainer.className = "transcript-column";
        this._transcriptContainer.style.display = "none"; // Hidden by default
        
        // Header
        this._headerElement = document.createElement("div");
        this._headerElement.className = "column-header";
        this._headerElement.innerHTML = `
            <span class="header-title">📝 Live Transskript</span>
        `;
        this._transcriptContainer.appendChild(this._headerElement);
        
        // Status message (hidden by default)
        this._statusMessage = document.createElement("div");
        this._statusMessage.className = "transcript-status-message";
        this._statusMessage.textContent = "Waiting for guest conversation...";
        this._statusMessage.style.display = "none";
        this._transcriptContainer.appendChild(this._statusMessage);
        
        // Transcript list
        this._transcriptList = document.createElement("div");
        this._transcriptList.className = "transcript-list";
        this._transcriptContainer.appendChild(this._transcriptList);
        
        this._mainContainer.appendChild(this._transcriptContainer);
    }
    
    /**
     * Create Column 2: AI Chat Interface
     */
    private createAIChatColumn(): void {
        this._aiChatContainer = document.createElement("div");
        this._aiChatContainer.className = "ai-chat-column";
        
        // Header with toggle button
        const header = document.createElement("div");
        header.className = "column-header";
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        
        const title = document.createElement("span");
        title.className = "header-title";
        title.textContent = "🤖 AI Assistent";
        header.appendChild(title);
        
        // Add toggle transcript button
        this._toggleTranscriptButton = document.createElement("button");
        this._toggleTranscriptButton.className = "toggle-transcript-btn";
        this._toggleTranscriptButton.textContent = "Vis Transskript";
        this._toggleTranscriptButton.style.fontSize = "12px";
        this._toggleTranscriptButton.style.padding = "4px 12px";
        this._toggleTranscriptButton.style.marginLeft = "auto";
        this._toggleTranscriptButton.addEventListener("click", () => this.toggleTranscriptVisibility());
        header.appendChild(this._toggleTranscriptButton);
        
        this._aiChatContainer.appendChild(header);
        
        // Chat messages area
        this._aiChatMessagesContainer = document.createElement("div");
        this._aiChatMessagesContainer.className = "ai-chat-messages";
        this._aiChatContainer.appendChild(this._aiChatMessagesContainer);
        
        // Add welcome message
        this.addAIMessage("Hello! I'm your AI assistant. Ask me anything about the guest conversation or request suggestions.", "ai");
        
        // Input area
        const inputContainer = document.createElement("div");
        inputContainer.className = "ai-chat-input-container";
        
        this._aiChatInput = document.createElement("input");
        this._aiChatInput.type = "text";
        this._aiChatInput.className = "ai-chat-input";
        this._aiChatInput.placeholder = "Stil AI et spørgsmål om samtalen...";
        this._aiChatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && this._aiChatInput.value.trim()) {
                this.handleAIChatSubmit();
            }
        });
        
        const sendButton = document.createElement("button");
        sendButton.className = "ai-chat-send-btn";
        sendButton.textContent = "Send";
        sendButton.addEventListener("click", () => this.handleAIChatSubmit());
        
        inputContainer.appendChild(this._aiChatInput);
        inputContainer.appendChild(sendButton);
        this._aiChatContainer.appendChild(inputContainer);
        
        this._mainContainer.appendChild(this._aiChatContainer);
    }
    
    /**
     * Create Column 3: Guest Info + Suggested Actions
     */
    private createInfoColumn(): void {
        this._infoPanelContainer = document.createElement("div");
        this._infoPanelContainer.className = "info-column";
        
        // Top: Guest Information
        this._guestInfoPanel = document.createElement("div");
        this._guestInfoPanel.className = "guest-info-panel";
        this.renderGuestInfo();
        this._infoPanelContainer.appendChild(this._guestInfoPanel);
        
        // Bottom: Suggested Actions
        this._actionsPanel = document.createElement("div");
        this._actionsPanel.className = "actions-panel";
        this.renderSuggestedActions();
        this._infoPanelContainer.appendChild(this._actionsPanel);
        
        this._mainContainer.appendChild(this._infoPanelContainer);
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
        
        // Clear AI conversation and get fresh analysis on new transcript message
        if (this._azureOpenAIEndpoint && this._transcriptUtterances.length > 0) {
            // Clear previous AI messages
            this._aiChatMessages = [];
            this._conversationHistory = [];
            this._aiChatMessagesContainer.innerHTML = "";
            
            // Get fresh analysis
            const transcriptJSON = this.getTranscriptJSON();
            const analysisPrompt = this.formatTranscriptForAgent(transcriptJSON);
            this.sendToAzureOpenAI(analysisPrompt).then(response => {
                if (response && response.message) {
                    // Proactive AI insights appear automatically
                    this.addAIMessage(response.message, "ai");
                }
            }).catch(err => {
                console.error("[TranscriptViewer] Failed to send to Azure OpenAI:", err);
            });
        }
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
        
        // Display speaker name: use current user name for Agent, "Customer" for guest
        const displayName = utterance.speaker === "Agent" ? this._currentUserName : "Customer";
        
        utteranceElement.innerHTML = `
            <div class="utterance-header">
                <span class="speaker">${this.escapeHtml(displayName)}</span>
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
     * Handle AI chat message submission
     */
    private async handleAIChatSubmit(): Promise<void> {
        const message = this._aiChatInput.value.trim();
        if (!message) return;
        
        // Add user message
        this.addAIMessage(message, "user");
        
        // Clear input
        this._aiChatInput.value = "";
        
        // Get current transcript context
        const transcriptContext = this.formatTranscriptForAgent(this.getTranscriptJSON());
        const fullMessage = `${transcriptContext}\n\nUser Question: ${message}`;
        
        // Send to Azure OpenAI
        if (this._azureOpenAIEndpoint) {
            const response = await this.sendToAzureOpenAI(fullMessage);
            
            if (response && response.message) {
                this.addAIMessage(response.message, "ai");
            }
        } else {
            this.addAIMessage("Azure OpenAI not configured. Please check setup.", "ai");
        }
    }
    
    /**
     * Add a message to the AI chat
     */
    private addAIMessage(text: string, sender: "user" | "ai"): void {
        const message: AIChatMessage = {
            id: `ai-msg-${Date.now()}-${Math.random()}`,
            sender: sender,
            text: text,
            timestamp: new Date()
        };
        
        this._aiChatMessages.push(message);
        this.renderAIMessage(message);
        
        // Auto-scroll to bottom after DOM update
        requestAnimationFrame(() => {
            setTimeout(() => {
                this._aiChatMessagesContainer.scrollTop = this._aiChatMessagesContainer.scrollHeight;
            }, 100);
        });
    }
    
    /**
     * Parse markdown formatting in AI messages
     */
    private parseMarkdown(text: string): string {
        // Bold: **text** or __text__
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
        
        // Headers: ### text - just bold them, hide the ###
        text = text.replace(/^###\s+(.+)$/gm, '<div style="margin: 12px 0 6px 0; font-weight: 600; font-size: 14px; color: var(--colorNeutralForeground1);">$1</div>');
        text = text.replace(/^##\s+(.+)$/gm, '<div style="margin: 12px 0 6px 0; font-weight: 600; font-size: 14px; color: var(--colorNeutralForeground1);">$1</div>');
        
        // Bullet lists: - item or * item
        text = text.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin-left: 20px; margin-bottom: 4px;">$1</li>');
        
        // Wrap consecutive <li> in <ul> - split by double newline to handle list groups
        const lines = text.split('\n');
        let inList = false;
        const processed: string[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('<li')) {
                if (!inList) {
                    processed.push('<ul style="margin: 8px 0; padding-left: 0; list-style-position: inside;">');
                    inList = true;
                }
                processed.push(line);
            } else {
                if (inList) {
                    processed.push('</ul>');
                    inList = false;
                }
                processed.push(line);
            }
        }
        if (inList) processed.push('</ul>');
        
        text = processed.join('\n');
        
        // Line breaks
        text = text.replace(/\n/g, '<br>');
        
        return text;
    }
    
    /**
     * Render an AI chat message
     */
    private renderAIMessage(message: AIChatMessage): void {
        const messageElement = document.createElement("div");
        messageElement.className = `ai-message ${message.sender}`;
        
        const timeString = message.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        const senderLabel = message.sender === "user" ? "User" : "Agent";
        
        // Parse markdown for AI messages, escape HTML for user messages
        const messageContent = message.sender === "ai" 
            ? this.parseMarkdown(message.text)
            : this.escapeHtml(message.text);
        
        messageElement.innerHTML = `
            <div class="ai-message-header">
                <span class="ai-sender">${senderLabel}:</span>
            </div>
            <div class="ai-message-content">${messageContent}</div>
            <div class="ai-message-time">${timeString}</div>
        `;
        
        this._aiChatMessagesContainer.appendChild(messageElement);
    }
    
    /**
     * Render guest information panel
     */
    private renderGuestInfo(): void {
        this._guestInfoPanel.innerHTML = `
            <div class="column-header">
                <span class="header-title">👤 Gæsteinformation</span>
            </div>
            <div class="guest-info-content">
                <div class="info-row">
                    <span class="info-label">Navn:</span>
                    <span class="info-value" id="guestName">${this.escapeHtml(this._guestInfo.name)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Værelse:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.room)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Check-in:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.checkIn)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Check-out:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.checkOut)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Telefon:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.phone)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Email:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.email)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Loyalitetsstatus:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.loyalty)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Præferencer:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.preferences)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Noter:</span>
                    <span class="info-value">${this.escapeHtml(this._guestInfo.notes)}</span>
                </div>
            </div>
        `;
    }
    
    /**
     * Render suggested actions panel (common hotel reception tasks)
     */
    private renderSuggestedActions(): void {
        const actions: SuggestedAction[] = [
            {
                id: "check-in",
                title: "Check-In Gæst",
                description: "Process indcheck & værelsesnøgle",
                icon: "🔑"
            },
            {
                id: "check-out",
                title: "Check-Out Gæst",
                description: "Process afrejse & fakturering",
                icon: "💳"
            },
            {
                id: "room-service",
                title: "Room Service",
                description: "Bestil mad eller service",
                icon: "🍽️"
            },
            {
                id: "booking-modify",
                title: "Ændre Booking",
                description: "Ændr datoer eller værelsestype",
                icon: "📅"
            },
            {
                id: "housekeeping",
                title: "Rengøring",
                description: "Book værelsesrengøring",
                icon: "🧹"
            },
            {
                id: "restaurant",
                title: "Restaurant Booking",
                description: "Reserver bord i restaurant",
                icon: "🍴"
            },
            {
                id: "spa",
                title: "Spa Behandling",
                description: "Book wellness behandling",
                icon: "💆"
            },
            {
                id: "upgrade",
                title: "Værelses Opgradering",
                description: "Tilbyd suite eller upgrade",
                icon: "⬆️"
            }
        ];
        
        let actionsHTML = `
            <div class="column-header">
                <span class="header-title">✨ Foreslåede Handlinger</span>
            </div>
            <div class="actions-content">
        `;
        
        actions.forEach(action => {
            actionsHTML += `
                <button class="action-button" data-action-id="${action.id}">
                    <span class="action-icon">${action.icon}</span>
                    <div class="action-text">
                        <div class="action-title">${this.escapeHtml(action.title)}</div>
                        <div class="action-description">${this.escapeHtml(action.description)}</div>
                    </div>
                </button>
            `;
        });
        
        actionsHTML += `</div>`;
        this._actionsPanel.innerHTML = actionsHTML;
        
        // Add click handlers for action buttons
        const actionButtons = this._actionsPanel.querySelectorAll('.action-button');
        actionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const actionId = (e.currentTarget as HTMLElement).getAttribute('data-action-id');
                this.handleActionClick(actionId);
            });
        });
    }
    
    /**
     * Handle action button clicks
     */
    private handleActionClick(actionId: string | null): void {
        if (!actionId) return;
        
        console.log(`[HotelReception] Action clicked: ${actionId}`);
        
        // Show toast notification
        const actionTitles: { [key: string]: string } = {
            "check-in": "Check-In Guest",
            "check-out": "Check-Out Guest",
            "room-service": "Room Service",
            "booking-modify": "Modify Booking",
            "housekeeping": "Housekeeping Request"
        };
        
        const actionTitle = actionTitles[actionId] || actionId;
        this.showToast(`Action triggered: ${actionTitle}`);
        
        // Add to AI chat as user action
        this.addAIMessage(`I want to: ${actionTitle}`, "user");
    }
    
    /**
     * Get current user name from context
     */
    private async getCurrentUserName(): Promise<void> {
        try {
            const userSettings = this._context.userSettings;
            this._currentUserName = userSettings.userName || "Agent";
            console.log(`[HotelReception] Current user: ${this._currentUserName}`);
        } catch (error) {
            console.error("[HotelReception] Error getting user name:", error);
            this._currentUserName = "Agent";
        }
    }
    
    /**
     * Update guest information (placeholder - replace with actual data source)
     */
    private updateGuestInfo(data: Partial<typeof this._guestInfo>): void {
        Object.assign(this._guestInfo, data);
        
        // Update the UI
        const nameElement = this._guestInfoPanel.querySelector('#guestName');
        if (nameElement) {
            nameElement.textContent = this._guestInfo.name;
        } else {
            this.renderGuestInfo();
        }
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
     * Toggle Live Transcript visibility
     */
    private toggleTranscriptVisibility(): void {
        this._isTranscriptVisible = !this._isTranscriptVisible;
        
        if (this._isTranscriptVisible) {
            // Show transcript - 3 column layout
            this._transcriptContainer.style.display = "flex";
            this._mainContainer.classList.remove("transcript-hidden");
            if (this._toggleTranscriptButton) {
                this._toggleTranscriptButton.textContent = "Skjul Transskript";
                this._toggleTranscriptButton.classList.add("active");
            }
        } else {
            // Hide transcript - 2 column layout
            this._transcriptContainer.style.display = "none";
            this._mainContainer.classList.add("transcript-hidden");
            if (this._toggleTranscriptButton) {
                this._toggleTranscriptButton.textContent = "Vis Transskript";
                this._toggleTranscriptButton.classList.remove("active");
            }
        }
    }
    
    /**
     * Show toast notification
     */
    private showToast(message: string, duration: number = 3000): void {
        if (!this._toastContainer) return;
        
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = message;
        
        this._toastContainer.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => toast.classList.add("show"), 10);
        
        // Remove after duration
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    /**
     * Get transcript as JSON for Azure Foundry
     */
    private getTranscriptJSON(): any {
        return {
            Subject: this._conversationTitle,
            Transcript: {
                Messages: this._transcriptUtterances.map(u => ({
                    Caller: u.speaker,
                    Message: u.text,
                    Timestamp: u.timestamp.toISOString()
                }))
            },
            AIAssistant: this._aiChatMessages.map(m => ({
                Sender: m.sender === "user" ? "User" : "Agent",
                Message: m.text,
                Timestamp: m.timestamp.toISOString()
            }))
        };
    }
    
    /**
     * Send message to Azure OpenAI Chat Completions
     */
    private async sendToAzureOpenAI(userMessage: string): Promise<any> {
        if (!this._azureOpenAIEndpoint || !this._azureOpenAIKey) {
            console.warn("[TranscriptViewer] Azure OpenAI not configured");
            this.addAIMessage("Azure AI not configured.", "ai");
            return null;
        }
        
        try {
            console.log("[TranscriptViewer] Sending to Azure OpenAI:", userMessage);
            
            // Add user message to history
            this._conversationHistory.push({
                role: "user",
                content: userMessage
            });
            
            // Build messages array with system prompt
            const messages = [
                { role: "system", content: this._systemPrompt },
                ...this._conversationHistory
            ];
            
            const url = `${this._azureOpenAIEndpoint}/openai/deployments/${this._azureOpenAIDeployment}/chat/completions?api-version=2025-01-01-preview`;
            
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "api-key": this._azureOpenAIKey
                },
                body: JSON.stringify({
                    messages: messages,
                    max_tokens: 800,
                    temperature: 0.7,
                    top_p: 1
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Azure OpenAI API error: ${response.status} ${errorText}`);
            }
            
            const result = await response.json();
            console.log("[TranscriptViewer] Azure OpenAI response:", result);
            
            if (result.choices && result.choices.length > 0) {
                const assistantMessage = result.choices[0].message.content;
                
                // Add assistant response to history
                this._conversationHistory.push({
                    role: "assistant",
                    content: assistantMessage
                });
                
                // Keep history manageable (last 10 exchanges)
                if (this._conversationHistory.length > 20) {
                    this._conversationHistory = this._conversationHistory.slice(-20);
                }
                
                return { message: assistantMessage };
            }
            
            return { message: "No response from AI" };
        } catch (error: any) {
            console.error("[TranscriptViewer] Error calling Azure OpenAI:", error);
            const errorMsg = error.message || error.toString();
            this.addAIMessage(`Error: ${errorMsg.includes('401') ? 'Authentication failed - check API key' : errorMsg}`, "ai");
            this.showToast("Error communicating with AI");
            return null;
        }
    }
    
    /**
     * Format transcript JSON for the AI agent
     */
    private formatTranscriptForAgent(transcriptJSON: any): string {
        const messages = transcriptJSON.Transcript.Messages || [];
        const aiHistory = transcriptJSON.AIAssistant || [];
        
        let formatted = `**Current Conversation**\n\n`;
        
        if (messages.length > 0) {
            formatted += `**Transcript:**\n`;
            messages.forEach((msg: any) => {
                formatted += `${msg.Caller}: ${msg.Message}\n`;
            });
            formatted += `\n`;
        }
        
        if (aiHistory.length > 0) {
            formatted += `**Previous AI Interactions:**\n`;
            aiHistory.forEach((msg: any) => {
                formatted += `${msg.Sender}: ${msg.Message}\n`;
            });
            formatted += `\n`;
        }
        
        formatted += `\nPlease analyze this conversation and provide insights, suggestions, or answer any questions.`;
        
        return formatted;
    }
    
    /**
     * Configure Azure OpenAI
     */
    public async configureAzureFoundry(endpoint: string, apiKey: string, deployment?: string): Promise<void> {
        this._azureOpenAIEndpoint = endpoint;
        this._azureOpenAIKey = apiKey;
        
        if (deployment) {
            this._azureOpenAIDeployment = deployment;
        }
        
        console.log(`[TranscriptViewer] Azure OpenAI configured: ${endpoint}`);
        console.log(`[TranscriptViewer] Using deployment: ${this._azureOpenAIDeployment}`);
        
        this.showToast("AI Assistant connected");
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
