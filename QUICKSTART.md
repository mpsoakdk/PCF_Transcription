# Quick Start Guide - Live Transcript Control

Get the Live Transcript Control running in 15 minutes!

## Prerequisites Checklist

- [ ] Dynamics 365 Customer Service with Omnichannel
- [ ] Voice channel enabled
- [ ] Node.js installed
- [ ] Power Apps CLI installed (`pac` command available)
- [ ] System Customizer or System Administrator role

## Step 1: Build the Control (2 minutes)

Open PowerShell in the project directory:

```powershell
cd C:\Users\MaleneGruber\PCF_CopilotTranscript

# Install dependencies
npm install

# Build the control
npm run build
```

✅ **Success Check**: You should see "Build completed successfully" message.

## Step 2: Deploy to Dynamics 365 (3 minutes)

### Option A: Quick Deploy with PAC CLI

```powershell
# Authenticate to your environment
pac auth create --url https://yourorg.crm.dynamics.com

# Push the control
pac pcf push --publisher-prefix yourprefix
```

### Option B: Manual Import

1. Package the control:
   ```powershell
   pac solution init --publisher-name YourOrg --publisher-prefix yourprefix
   pac solution add-reference --path .\
   msbuild /t:build /restore
   ```

2. Import the solution ZIP from the `bin` folder in Power Apps

✅ **Success Check**: Control appears in the component library in Power Apps.

## Step 3: Add Control to Form (5 minutes)

1. **Navigate to Form Designer**
   - Go to https://make.powerapps.com
   - Solutions → Tables → Search for "Conversation" or "msdyn_ocsession"
   - Forms → Select the main form used in Customer Service workspace

2. **Add the Control**
   - Click "+ Component" in a section
   - Search for "Live Transcript Control"
   - Add it to the form

3. **Configure Properties**
   - **Conversation ID**: Bind to `msdyn_ocsessionid` (the primary key field)
   - **Max Height**: Set to `400` or your preferred height in pixels

4. **Save and Publish**
   - Click "Save"
   - Click "Publish"

✅ **Success Check**: Control appears on the Conversation form (you may need to refresh).

## Step 4: Test the Control (5 minutes)

### Quick Test with Browser Console

1. **Open Customer Service Workspace**
   - Navigate to your Customer Service workspace app
   - Open any Conversation record (or create a test one)

2. **Open Browser DevTools**
   - Press F12
   - Go to the Console tab

3. **Load the Test Script**
   - Copy the contents of `examples/TestTranscriptPublisher.js`
   - Paste into the console and press Enter

4. **Run the Demo**
   ```javascript
   TestTranscriptPublisher.startDemo()
   ```

5. **Watch the Magic!**
   - You should see transcript messages appearing in the control
   - Messages auto-scroll
   - Different speakers have different colors

✅ **Success Check**: You see sample conversation messages appearing in the control.

## Step 5: Set Up Real Integration (Optional)

For real live transcription, you need to publish transcript events. Choose one:

### Option A: Test with Manual Events

Stay in the console and publish individual messages:

```javascript
// Get the conversation ID
const convId = Xrm.Page.data.entity.getId().replace(/[{}]/g, '');

// Publish a message
window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
    detail: {
        conversationId: convId,
        utterance: {
            speaker: 'Agent',
            text: 'Hello, how can I help?',
            timestamp: new Date().toISOString()
        }
    }
}));
```

### Option B: Add Web Resource (Production)

1. **Upload the Publisher**
   - Go to Solutions → Web Resources → New
   - Upload `examples/OmnichannelTranscriptPublisher.js`
   - Set name: `yourprefix_OmnichannelTranscriptPublisher`
   - Save and Publish

2. **Add to Form**
   - Open Conversation form in designer
   - Go to Form Properties → Events → OnLoad
   - Add library: `yourprefix_OmnichannelTranscriptPublisher`
   - Add handler: `OmnichannelTranscriptPublisher.initialize`
   - Check "Pass execution context"
   - Save and Publish

3. **Test the Publisher**
   - Open a Conversation record
   - Open browser console
   - Run: `window.OmnichannelTranscriptPublisher.test()`
   - You should see test messages in the control

✅ **Success Check**: Web resource publishes events to the control.

## Troubleshooting

### "Control doesn't appear on form"
- Clear browser cache (Ctrl+Shift+Delete)
- Refresh the form
- Check that you published the form
- Verify the control is in the correct section

### "No transcript data appears"
- Check browser console for errors
- Verify conversation ID is bound correctly
- Make sure you're running the test script
- Check that events are being dispatched

### "Build fails"
- Delete `node_modules` folder
- Run `npm install` again
- Check for TypeScript errors in the output

### "Can't authenticate with PAC CLI"
- Update PAC CLI: `pac install latest`
- Try interactive auth: `pac auth create --interactive`
- Check your user has permissions

## Next Steps

Now that the control is working:

1. **Customize Styling**
   - Edit `SampleControl/css/LiveTranscriptControl.css`
   - Match your organization's branding

2. **Implement Real Integration**
   - Connect to your transcript service
   - Modify the web resource to capture real transcripts
   - See DEPLOYMENT.md for integration patterns

3. **Add Features**
   - Export functionality
   - Search/filter
   - AI summarization
   - Translation

## Quick Reference Card

### Test Commands (Browser Console)

```javascript
// Load test script first, then:

TestTranscriptPublisher.startDemo()              // Run sample conversation
TestTranscriptPublisher.publishSingle('Agent', 'Hi!') // Single message
TestTranscriptPublisher.testSentiment()          // Test sentiment colors
TestTranscriptPublisher.help()                   // Show all commands
```

### Event Format (For Custom Integration)

```javascript
window.dispatchEvent(new CustomEvent('omnichannelTranscriptUpdate', {
    detail: {
        conversationId: "guid-without-braces",
        utterance: {
            speaker: "Agent",        // or "Customer", "System"
            text: "Message text",
            timestamp: "2025-11-27T12:00:00Z",
            sentiment: "positive"    // optional: positive, neutral, negative
        }
    }
}));
```

## Support

- 📖 **Full Documentation**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- 📚 **Technical Details**: See [README.md](./README.md)
- 💡 **Examples**: Check `examples/` folder
- 🐛 **Issues**: Check browser console for diagnostic messages

## Success! 🎉

If you've followed all steps, you now have a working live transcript control!

**What you've accomplished:**
✅ Built a custom PCF control
✅ Deployed it to Dynamics 365
✅ Added it to the Conversation form
✅ Tested with sample data

**Next milestone:**
🎯 Connect to real transcript data from your voice calls

---

**Time invested**: ~15 minutes  
**Value delivered**: Real-time transcript visibility for agents

Happy coding! 🚀
