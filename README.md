# Live Transcript Control for Dynamics 365 Customer Service

A Power Apps Component Framework (PCF) control that displays live voice transcription for ongoing voice calls in Dynamics 365 Customer Service workspace.

## 🎯 Purpose

This control enables agents to view real-time voice transcription directly on the Conversation form (msdyn_ocsession) during voice calls, providing:

- **Live transcript display** during active voice calls
- **Speaker identification** (Agent vs Customer)
- **Sentiment indicators** (positive, neutral, negative)
- **Auto-scrolling** to latest utterances
- **Professional UI** matching Dynamics 365 design language

## ⚠️ Important Notice: API Limitations

**Microsoft does not currently expose public APIs for accessing live voice transcription from PCF controls.**

This control provides the UI framework and event subscription mechanisms, but requires **custom integration** to receive transcript data. See [DEPLOYMENT.md](./DEPLOYMENT.md) for integration options.

## 📋 Features

### Core Functionality

✅ Displays live transcript in a scrollable panel  
✅ Shows speaker labels (Agent/Customer/System)  
✅ Timestamps for each utterance  
✅ Auto-scroll to newest messages  
✅ Sentiment visualization (when available)  
✅ Responsive design  
✅ Dark mode support  
✅ High contrast mode support

### Integration Methods

The control supports **three integration approaches**:

1. **Custom Events** - Recommended for production
   ```javascript
   window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
       detail: {
           conversationId: "guid",
           utterance: {
               speaker: "Agent",
               text: "Hello, how can I help?",
               timestamp: new Date().toISOString()
           }
       }
   }));
   ```

2. **PostMessage** - Alternative integration
   ```javascript
   window.postMessage({
       type: "omnichannelTranscriptUpdate",
       conversationId: "guid",
       speaker: "Customer",
       text: "I need assistance",
       timestamp: new Date().toISOString()
   }, "*");
   ```

3. **WebAPI Polling** - Fallback (post-call only)
   - Polls msdyn_transcript table
   - Only retrieves transcripts after call ends
   - Disabled by default

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Customer Service Workspace                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Conversation Form (msdyn_ocsession)         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │      Live Transcript Control (PCF)              │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  Event Listeners:                         │  │  │  │
│  │  │  │  - omnichannelTranscriptUpdate (Custom)   │  │  │  │
│  │  │  │  - window.postMessage                     │  │  │  │
│  │  │  │  - WebAPI polling (optional)              │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ Events
                            │
┌────────────────────────────────────────────────────────────┐
│        Custom Web Resource / Browser Extension             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  - Monitors Omnichannel transcript panel             │  │
│  │  - Publishes events to PCF control                   │  │
│  │  - OR: Connects to backend transcript service        │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Dynamics 365 Customer Service with Omnichannel
- Voice channel enabled
- Node.js 14+
- Power Apps CLI (PAC CLI)

### Build and Deploy

```powershell
# 1. Install dependencies
npm install

# 2. Build the control
npm run build

# 3. Test locally (optional)
npm start watch

# 4. Deploy to Dynamics 365
pac pcf push --publisher-prefix yourprefix
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment instructions.

## 📦 Project Structure

```
PCF_CopilotTranscript/
├── SampleControl/
│   ├── ControlManifest.Input.xml    # Control metadata and properties
│   ├── index.ts                      # Main control logic
│   ├── css/
│   │   └── LiveTranscriptControl.css # Styles
│   └── generated/
│       └── ManifestTypes.d.ts        # Auto-generated types
├── package.json                      # NPM dependencies
├── tsconfig.json                     # TypeScript configuration
├── DEPLOYMENT.md                     # Deployment guide
└── README.md                         # This file
```

## 🔧 Configuration

### Control Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `conversationId` | String | Yes | Bound to msdyn_ocsessionid |
| `maxHeight` | Number | No | Maximum height in pixels (default: 400) |

### Bind to Conversation Form

1. Add control to msdyn_ocsession form
2. Bind `conversationId` to `msdyn_ocsessionid`
3. Set desired `maxHeight`

## 💡 Integration Examples

### Example 1: Simple Test Integration

Run in browser console on Conversation form:

```javascript
// Get current conversation ID
const conversationId = Xrm.Page.data.entity.getId().replace(/[{}]/g, '');

// Publish a test utterance
window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
    detail: {
        conversationId: conversationId,
        utterance: {
            speaker: 'Agent',
            text: 'Hello, how can I help you today?',
            timestamp: new Date().toISOString(),
            sentiment: 'positive'
        }
    }
}));
```

### Example 2: Web Resource Integration

```javascript
// OmnichannelTranscriptPublisher.js
(function() {
    // Monitor transcript panel DOM changes
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (isTranscriptMessage(node)) {
                    publishTranscript(
                        extractSpeaker(node),
                        extractText(node),
                        extractTimestamp(node)
                    );
                }
            });
        });
    });
    
    observer.observe(transcriptPanel, { childList: true, subtree: true });
    
    function publishTranscript(speaker, text, timestamp) {
        const conversationId = getConversationId();
        window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
            detail: {
                conversationId: conversationId,
                utterance: { speaker, text, timestamp }
            }
        }));
    }
})();
```

### Example 3: Backend Service Integration

```javascript
// Connect to a backend SignalR hub that streams transcripts
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/transcriptHub")
    .build();

connection.on("TranscriptUpdate", function(data) {
    window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
        detail: {
            conversationId: data.conversationId,
            utterance: {
                speaker: data.speaker,
                text: data.text,
                timestamp: data.timestamp,
                sentiment: data.sentiment
            }
        }
    }));
});

connection.start();
```

## 🎨 Customization

### Styling

Edit `SampleControl/css/LiveTranscriptControl.css`:

```css
/* Change header color */
.transcript-header {
    background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%);
}

/* Customize agent message color */
.transcript-utterance.agent {
    background-color: #deecf9;
    border-left: 4px solid #0078d4;
}
```

### Add New Features

Example: Add export functionality

```typescript
// In index.ts
private exportTranscript(): void {
    const text = this._transcriptUtterances
        .map(u => `[${u.timestamp}] ${u.speaker}: ${u.text}`)
        .join('\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${this._conversationId}.txt`;
    a.click();
}
```

## 🐛 Troubleshooting

### Control doesn't appear
- Verify solution is imported and published
- Clear browser cache (Ctrl+Shift+Delete)
- Check browser console for errors

### No transcript data
- Ensure event publishing is configured
- Check conversation ID matches
- Verify event format matches expected structure

### Console errors
- Check TypeScript compilation errors: `npm run build`
- Verify all dependencies installed: `npm install`
- Review browser console for runtime errors

### Performance issues
- Limit displayed utterances (add max limit)
- Reduce polling frequency if enabled
- Use virtual scrolling for many messages

## 📊 Event Data Schema

### Custom Event Structure

```typescript
interface OmnichannelTranscriptEvent {
    conversationId: string;        // GUID of msdyn_ocsession
    utterance: {
        speaker: string;           // "Agent", "Customer", or "System"
        text: string;              // The utterance text
        timestamp: string;         // ISO 8601 datetime
        sentiment?: string;        // Optional: "positive", "neutral", "negative"
    };
}
```

### PostMessage Structure

```typescript
interface TranscriptPostMessage {
    type: "omnichannelTranscriptUpdate";
    conversationId: string;
    speaker: string;
    text: string;
    timestamp: string;
    sentiment?: string;
}
```

## 🔐 Security

- **XSS Protection**: All text is HTML-escaped
- **Origin Validation**: Consider validating postMessage origins
- **Data Privacy**: Transcripts may contain PII - ensure proper access controls
- **CSP Compliance**: Control follows Dynamics 365 CSP policies

## 📚 Resources

### Microsoft Documentation
- [PCF Controls Overview](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/overview)
- [Customer Service Voice Channel](https://learn.microsoft.com/en-us/dynamics365/customer-service/voice-channel)
- [Omnichannel Developer Guide](https://learn.microsoft.com/en-us/dynamics365/customer-service/develop/omnichannel-developer)

### Related Technologies
- [TypeScript](https://www.typescriptlang.org/)
- [Power Apps CLI](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/powerapps-cli)
- [Azure Communication Services](https://learn.microsoft.com/en-us/azure/communication-services/)

## 🤝 Contributing

This is a starting point for your organization's implementation. Common enhancements:

1. **AI Integration**: Add conversation summarization using Azure OpenAI
2. **Analytics**: Track conversation metrics and sentiment trends
3. **Multi-language**: Add translation support for multilingual calls
4. **Search**: Add search/filter functionality for transcript
5. **Export**: Add export to PDF, Word, or email

## 📝 License

This is a sample implementation for Dynamics 365 Customer Service. Customize as needed for your organization.

## ⚙️ Technical Details

### Browser Compatibility
- Microsoft Edge (Chromium)
- Google Chrome
- Supports modern ES6+ features

### Dependencies
- `@types/powerapps-component-framework`: ^1.3.16
- `typescript`: ^5.8.3
- `pcf-scripts`: ^1

### Performance
- Minimal memory footprint
- Efficient DOM updates
- Lazy rendering for large transcripts

## 📞 Support

For implementation assistance:

1. Review [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed setup instructions
2. Check browser console for diagnostic messages
3. Verify event format matches documented schema
4. Test with manual event publishing before implementing full integration

## 🔮 Future Enhancements

When Microsoft exposes official transcript APIs:

- Direct integration with Omnichannel transcript stream
- Real-time sentiment analysis
- Speaker diarization
- Automatic language detection
- Keyword highlighting
- Voice-to-text confidence scores

Monitor [Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/customer-service/) for API updates.

---

**Built with** ❤️ **for Dynamics 365 Customer Service**
