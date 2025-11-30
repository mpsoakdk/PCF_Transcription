# Live Transcript Control - Deployment Guide

## Overview

This PCF control displays live voice transcription for Dynamics 365 Customer Service voice calls on the Conversation form (msdyn_ocsession).

**Control Name:** `LiveTranscriptControl`  
**Namespace:** `OmnichannelVoice`  
**Version:** 1.0.0

---

## ⚠️ Important: Live Transcription Integration

### Current Microsoft API Limitations

As of November 2025, Microsoft does **not** expose public APIs for accessing real-time voice transcription events from within PCF controls. The live transcript feature is tightly integrated into the Customer Service workspace UI, and its data is not directly accessible via:

- Omnichannel JavaScript SDK
- Customer Service workspace client APIs
- WebAPI during active calls

### How This Control Works

This control implements **three integration approaches**:

1. **Custom Event Listener** (Recommended)
   - Listens for `omnichannelTranscriptUpdate` custom events
   - Requires workspace-level customization to publish events
   - Best for production use with proper integration

2. **PostMessage Handler** (Alternative)
   - Listens for window.postMessage events
   - Can be used with browser extensions or custom scripts

3. **WebAPI Polling** (Fallback - Post-Call Only)
   - Polls msdyn_transcript table
   - ⚠️ **Only works AFTER call ends** (not live)
   - Disabled by default

---

## Prerequisites

### System Requirements

- Dynamics 365 Customer Service with Omnichannel for Customer Service
- Voice channel enabled and configured
- Customer Service workspace app
- Power Apps Component Framework SDK
- Node.js (v14 or later)
- PowerApps CLI (PAC CLI)

### User Permissions

- System Customizer or System Administrator role
- Access to the msdyn_ocsession entity
- Ability to edit model-driven app forms

---

## Quick Deploy Commands

### Standard Build and Deploy
```powershell
# Navigate to project directory
cd C:\Users\MikePoulsen\PCF_Transcript\PCF_Transcription

# Build the control
npm run build

# Deploy to Dynamics 365
pac pcf push --publisher-prefix dev
```

### Single Command Deployment
```powershell
npm run build; pac pcf push --publisher-prefix dev
```

**Wait for:** "Updating the control in the current org: done." before refreshing browser.

### Control Details
- **Namespace**: `dev_ConversationInsights`
- **Control Name**: `TranscriptViewer`
- **Full Name**: `dev_ConversationInsights.TranscriptViewer`
- **Publisher Prefix**: `dev`
- **Deployment Target**: https://orgc8d5d032.crm4.dynamics.com

### After Deployment
1. **Hard refresh** browser (Ctrl+Shift+R or Ctrl+F5)
2. Check console (F12) for `[TranscriptViewer]` logs
3. Control updates are immediate after publish

---

## Build the PCF Control

### 1. Install Dependencies

```powershell
npm install
```

### 2. Build the Control

```powershell
npm run build
```

This will:
- Validate the manifest
- Compile TypeScript
- Bundle with Webpack
- Generate outputs in `out/controls/`

### 3. Build Output
```
[build] Validating manifest...
[build] Compiling and bundling control...
[Webpack stats]:
asset bundle.js 31.2 KiB [emitted] (name: main)
[build] Succeeded
```

---

## Deploy to Dynamics 365

### Authentication
The pac CLI should already be authenticated. If needed:

```powershell
# Create new auth profile
pac auth create --url https://orgc8d5d032.crm4.dynamics.com

# List auth profiles
pac auth list

# Clear all auth
pac auth clear
```

### Push Control
```powershell
pac pcf push --publisher-prefix dev
```

This command:
1. Connects to authenticated environment
2. Checks if control exists
3. Creates temporary solution wrapper
4. Builds the control
5. Imports solution
6. Publishes customizations
7. Updates the control

### Deployment Output
```
Connected as mp@soak.dk
Connected to... CustomerService Trial
Using publisher prefix 'dev'.
Checking if the control 'dev_ConversationInsights.TranscriptViewer' already exists...
Using full update.
Building temporary solution wrapper: done.
Importing temporary solution wrapper: done.
Publishing All Customizations...
Published All Customizations.
Updating the control in the current org: done.
```

---

## Development Workflow

### Iterative Changes
1. Edit `SampleControl/index.ts`
2. Run `npm run build`
3. Check for TypeScript/build errors
4. Run `pac pcf push --publisher-prefix dev`
5. Wait for "done" message
6. Hard refresh browser
7. Test and check console logs

### Quick Iteration
```powershell
npm run build; pac pcf push --publisher-prefix dev
```

---

## Troubleshooting

### Build Errors
```powershell
# Reinstall dependencies
npm install

# Clean and rebuild
npm run build
```

### Deployment Errors
```powershell
# Re-authenticate
pac auth clear
pac auth create --url https://orgc8d5d032.crm4.dynamics.com

# Try deploy again
pac pcf push --publisher-prefix dev
```

### Control Not Updating
1. Verify deployment completed successfully
2. Hard refresh browser (Ctrl+Shift+R)
3. Clear browser cache
4. Check if control version incremented in solution

---

## Add Control to the Conversation Form

### 1. Open Form Designer

1. Navigate to **Power Apps** > **Tables** > **Conversation (msdyn_ocsession)**
2. Open the **Forms** section
3. Select the form used in Customer Service workspace (typically "Main" or "Conversation Form")

### 2. Add the Control

1. In the form designer, add a new **One Column Section** or use an existing section
2. Click **+ Component** in the section
3. Search for "Live Transcript Control"
4. Add it to the form

### 3. Configure Properties

Configure the control properties:

- **Conversation ID**: Bind to the primary key field of msdyn_ocsession
  - Field: `msdyn_ocsessionid`
- **Max Height (px)**: Set the maximum height (default: 400)

### 4. Resize the Control

- Adjust the control height on the form (recommended: 400-600px)
- Ensure it has enough space to display transcript messages

### 5. Save and Publish

1. Click **Save**
2. Click **Publish**

---

## Enable Live Transcription Events

Since Microsoft doesn't provide native APIs, you need to implement event publishing. Choose one of these approaches:

### Option A: Custom Web Resource (Recommended)

Create a JavaScript web resource that monitors the Omnichannel transcript panel and publishes events.

#### 1. Create the Web Resource

Create a new JavaScript file `OmnichannelTranscriptPublisher.js`:

```javascript
/**
 * Omnichannel Transcript Event Publisher
 * Publishes transcript updates to the LiveTranscriptControl PCF
 */

(function() {
    console.log("[Omnichannel Transcript Publisher] Initializing...");
    
    // Get the current conversation ID from the form context
    function getConversationId() {
        try {
            const formContext = Xrm.Page; // or use passed context
            if (formContext && formContext.data && formContext.data.entity) {
                return formContext.data.entity.getId().replace(/[{}]/g, '');
            }
        } catch (e) {
            console.error("Error getting conversation ID:", e);
        }
        return null;
    }
    
    /**
     * Publish a transcript update event
     * This is the integration point for the PCF control
     */
    function publishTranscriptUpdate(speaker, text, timestamp, sentiment) {
        const conversationId = getConversationId();
        
        if (!conversationId) {
            console.warn("Cannot publish transcript: No conversation ID");
            return;
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
        console.log("[Transcript Publisher] Published update:", speaker, text);
    }
    
    /**
     * INTEGRATION OPTION 1: Monitor DOM for transcript changes
     * NOTE: This is fragile and may break with UI updates
     */
    function monitorTranscriptPanel() {
        // Find the Omnichannel transcript panel
        // The actual selector will depend on the Customer Service workspace structure
        const transcriptPanel = document.querySelector('[data-id="transcript-panel"]');
        
        if (!transcriptPanel) {
            console.warn("Transcript panel not found. Will retry...");
            setTimeout(monitorTranscriptPanel, 2000);
            return;
        }
        
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains('transcript-message')) {
                        // Extract transcript data from DOM
                        const speaker = node.querySelector('.speaker')?.textContent || 'Unknown';
                        const text = node.querySelector('.message-text')?.textContent || '';
                        const timestamp = node.dataset.timestamp || new Date().toISOString();
                        
                        publishTranscriptUpdate(speaker, text, timestamp);
                    }
                });
            });
        });
        
        observer.observe(transcriptPanel, { childList: true, subtree: true });
        console.log("[Transcript Publisher] Monitoring transcript panel");
    }
    
    /**
     * INTEGRATION OPTION 2: Hook into Omnichannel events
     * NOTE: Requires access to internal Omnichannel APIs (if available)
     */
    function hookOmnichannelEvents() {
        // Check if Microsoft.Omnichannel is available
        if (typeof Microsoft !== 'undefined' && Microsoft.Omnichannel) {
            console.log("[Transcript Publisher] Microsoft.Omnichannel detected");
            
            // Try to subscribe to transcript events
            // (This is speculative - actual API may differ)
            try {
                Microsoft.Omnichannel.on('transcriptUpdate', function(data) {
                    publishTranscriptUpdate(
                        data.speaker,
                        data.text,
                        data.timestamp,
                        data.sentiment
                    );
                });
            } catch (e) {
                console.warn("Could not hook Omnichannel events:", e);
            }
        }
    }
    
    /**
     * INTEGRATION OPTION 3: Use WebSocket or SignalR (if exposed)
     * NOTE: Requires backend implementation
     */
    function connectToTranscriptStream() {
        // If your organization has a backend service that streams transcripts
        // via WebSocket or SignalR, connect here
        
        // Example:
        // const connection = new signalR.HubConnectionBuilder()
        //     .withUrl("/transcriptHub")
        //     .build();
        // 
        // connection.on("ReceiveTranscript", function(data) {
        //     publishTranscriptUpdate(data.speaker, data.text, data.timestamp);
        // });
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    function init() {
        console.log("[Transcript Publisher] Initializing integrations...");
        
        // Try all integration methods
        hookOmnichannelEvents();
        monitorTranscriptPanel();
        
        // Expose API for manual testing
        window.OmnichannelTranscriptPublisher = {
            publish: publishTranscriptUpdate
        };
    }
})();
```

#### 2. Upload as Web Resource

1. Navigate to **Power Apps** > **Solutions** > Your Solution
2. Add **New** > **More** > **Web Resource**
3. Upload `OmnichannelTranscriptPublisher.js`
4. Set Type: **Script (JScript)**
5. Save and Publish

#### 3. Add to Form

1. Open the Conversation form in Form Designer
2. Go to **Form Properties** > **Events** > **OnLoad**
3. Add the web resource library
4. Add an event handler (can be a simple function that calls the publisher)

### Option B: Browser Extension or Custom Script

For development/testing, you can use a browser extension or console script:

```javascript
// Test script - run in browser console on Conversation form
function simulateTranscript() {
    const conversationId = Xrm.Page.data.entity.getId().replace(/[{}]/g, '');
    
    // Simulate agent utterance
    window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
        detail: {
            conversationId: conversationId,
            utterance: {
                speaker: 'Agent',
                text: 'Hello, how can I help you today?',
                timestamp: new Date().toISOString()
            }
        }
    }));
    
    // Simulate customer utterance
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
            detail: {
                conversationId: conversationId,
                utterance: {
                    speaker: 'Customer',
                    text: 'I have a question about my order.',
                    timestamp: new Date().toISOString()
                }
            }
        }));
    }, 2000);
}

// Run the simulation
simulateTranscript();
```

### Option C: Backend Integration

For enterprise production use, implement a backend service that:

1. Subscribes to Azure Communication Services (ACS) transcription events
2. Correlates them with Dynamics 365 conversations
3. Publishes events to the workspace via:
   - WebSocket/SignalR
   - Custom API that the web resource polls
   - Direct window.postMessage to the workspace

---

## Testing the Control

### 1. Manual Testing with Console

1. Open Customer Service workspace
2. Open a Conversation record (msdyn_ocsession)
3. Open browser DevTools (F12)
4. Run the test script above to simulate transcript events
5. Verify utterances appear in the control

### 2. Verify Integration

Check the console for log messages:

```
[LiveTranscriptControl] Initialized for conversation: <guid>
[LiveTranscriptControl] Subscribed to transcript events
[LiveTranscriptControl] Received transcript event: <data>
```

### 3. Test Real Voice Calls

If you have transcript event publishing configured:

1. Start a voice call in Customer Service workspace
2. Open the Conversation form
3. Verify the Live Transcript control shows utterances in real-time
4. Verify auto-scrolling works
5. Check speaker labels (Agent vs Customer)

---

## Troubleshooting

### Control Not Appearing

- Verify the solution is imported and published
- Check that the control is added to the correct form
- Ensure the form is published
- Clear browser cache and refresh

### No Transcript Data

- Check browser console for errors
- Verify conversation ID is being passed correctly
- Ensure transcript events are being published (check web resource)
- Enable polling temporarily to test (uncomment `startPolling()` in index.ts)

### Events Not Received

- Verify the web resource is loaded on the form
- Check that the custom event name matches: `omnichannelTranscriptUpdate`
- Ensure the conversation ID in events matches the current record

### Performance Issues

- Limit the number of utterances displayed (add max limit)
- Optimize rendering (use virtual scrolling for many messages)
- Reduce polling frequency if using polling

---

## Configuration Options

### Enable Polling (For Testing Only)

To enable WebAPI polling (only shows transcripts after call ends):

1. Open `SampleControl\index.ts`
2. Find the `subscribeToTranscriptEvents()` method
3. Uncomment the line: `this.startPolling();`
4. Rebuild and redeploy

### Adjust Polling Interval

Change `_pollingIntervalMs` in index.ts:

```typescript
private _pollingIntervalMs: number = 3000; // 3 seconds
```

### Customize Styling

Edit `SampleControl\css\LiveTranscriptControl.css` to match your organization's branding:

- Change header colors
- Adjust utterance bubble colors
- Modify fonts and spacing

---

## Security Considerations

1. **Content Security Policy**: Ensure your environment allows custom events and postMessage
2. **XSS Protection**: The control escapes all HTML in utterances
3. **Data Privacy**: Transcripts may contain sensitive information - ensure proper access controls
4. **Origin Validation**: Consider validating postMessage origins in production

---

## Monitoring for Future Microsoft APIs

Microsoft may expose official transcript APIs in the future. Monitor:

- [Microsoft Learn - Omnichannel Developer Documentation](https://learn.microsoft.com/en-us/dynamics365/customer-service/develop/omnichannel-developer)
- [Power Apps Component Framework Updates](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/overview)
- Dynamics 365 Release Plans

When official APIs become available, update the control's `subscribeToTranscriptEvents()` method to use them.

---

## Support and Customization

### Extending the Control

Common customizations:

1. **Add sentiment visualization**: Enhance sentiment display with colors/icons
2. **Search/Filter**: Add search box to filter transcript
3. **Export**: Add button to export transcript as text/PDF
4. **Summary**: Integrate with AI to show conversation summary
5. **Language support**: Add translation for multilingual support

### Code Structure

- `ControlManifest.Input.xml` - Control metadata and properties
- `index.ts` - Main control logic
- `css/LiveTranscriptControl.css` - Styles
- `generated/ManifestTypes.d.ts` - Auto-generated TypeScript types

---

## Additional Resources

- [PCF Control Documentation](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/overview)
- [Customer Service Voice Documentation](https://learn.microsoft.com/en-us/dynamics365/customer-service/voice-channel)
- [Omnichannel for Customer Service](https://learn.microsoft.com/en-us/dynamics365/customer-service/omnichannel-customer-service-guide)

---

## Change Log

### Version 1.0.0 (November 2025)
- Initial release
- Custom event listener integration
- PostMessage integration
- WebAPI polling (fallback)
- Auto-scrolling transcript display
- Speaker identification
- Sentiment support
- Responsive design
