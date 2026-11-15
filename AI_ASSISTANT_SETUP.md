# AI Clinical Assistant Setup Guide

## Overview
The AI Clinical Assistant is an intelligent chat interface powered by apifree.ai that helps dental professionals with clinical decisions, treatment protocols, and patient care guidance.

## Features
- **Real-time AI Chat**: Interactive conversation with AI trained on dental knowledge
- **Treatment Protocols**: Get detailed guidelines for procedures like root canals, extractions, crown preparations
- **Pain Management**: Medication recommendations and emergency care protocols
- **Pediatric Dentistry**: Age-specific treatment guidance and behavior management
- **Practice Context**: AI has access to your patient statistics and recent treatment data
- **Quick Prompts**: Pre-defined questions for common scenarios
- **Copy Responses**: Easily copy AI responses for documentation

## Setup Instructions

### Step 1: Get Your API Key

1. Visit [apifree.ai](https://apifree.ai)
2. Sign in or create an account
3. Navigate to API Keys management page
4. Create a new API key and copy it

### Step 2: Apply the secure database migration

Apply `supabase/migrations/20261115000000_ai_assistant_secure_settings.sql`
(or `database/ai_assistant_secure_settings.sql`) to the clinic database. It is
idempotent and creates the private encrypted settings storage plus
service-role-only RPCs.

### Step 3: Deploy the backend function

Deploy `supabase/functions/ai-assistant` with JWT verification disabled, matching
the existing `credential-auth` function. The function performs its own staff
session and administrator checks.

Optional but recommended: provision a dedicated 32-byte key with
`openssl rand -base64 32` and set it as `AI_SETTINGS_ENCRYPTION_KEY` in the Edge
Function secrets. Without it, encryption is derived from the existing service
role secret with HKDF-SHA256.

### Step 4: Save the key in the app

1. Sign in as an administrator.
2. Open **Settings → AI Assistant**.
3. Enter the API key and model, then choose **Save**.
4. Choose **Test connection** to confirm the saved key works.

The key is encrypted with AES-256-GCM before it is stored. It is never displayed
again and never sent to any browser. The configuration is shared by every user,
device and branch.

Do **not** add the key to `.env`, `vite.config.ts`, a `VITE_` variable, or a
Docker build argument. The frontend bundle must never contain it.

### Step 5: Verify Setup

1. Navigate to **"AI Assistant"** in the sidebar (Operations section)
2. Look for the status banner at the top:
   - ⚠️ **Yellow Banner** = Mock mode (API key not configured)
   - ✅ **No Banner** = Real AI mode (connected successfully)
   - ❌ **Red Banner** = Connection error (check API key or internet)

## Mock Mode (No API Key Required)

The AI Assistant works out-of-the-box with intelligent mock responses covering:
- Root canal procedures
- Cavity treatments
- Tooth extractions
- Pain management
- Crown preparations
- Pediatric dentistry
- Dental implants

**This is perfect for:**
- Testing the interface
- Demonstrations
- Training staff
- Deciding if you want to use real AI

## Real AI Mode (With API Key)

Once configured, you get:
- Dynamic responses to any dental question
- Context-aware answers based on your practice data
- Latest medical knowledge from advanced AI models
- Natural conversation flow
- More comprehensive clinical guidance

## API Key Security

⚠️ **Important Security Notes:**

1. **Never commit .env to git** - The `.env` file is already in `.gitignore`
2. **Keep your API key private** - Don't share it publicly
3. **Monitor usage**: Check your usage in apifree.ai dashboard

## Troubleshooting

### "Mock Mode Active" banner won't disappear
- ✅ Check that `.env` file exists (not `.env.example`)
- ✅ Restart the development server
- ✅ Clear browser cache and refresh

### "API Connection Error" message
- ✅ Check internet connection
- ✅ Verify API key is correct (try creating a new one)
- ✅ Check if API key has been revoked in apifree.ai dashboard
- ✅ Ensure no firewall blocking API requests

### AI Assistant says it is not configured
- ✅ Sign in as an administrator and open **Settings → AI Assistant**.
- ✅ Save the shared key, then choose **Test connection**.
- ✅ Confirm the `ai-assistant` function is deployed.
- ✅ Confirm the secure settings migration has been applied.
- ✅ Check that the Edge Function environment still has its service role secret.

### The saved key cannot be read
- ✅ If `AI_SETTINGS_ENCRYPTION_KEY` was removed or changed, save the AI key again.
- ✅ If the service role secret was rotated, save the AI key again.

## Code Integration Points

If you want to customize the AI Assistant, here are the key files:

### Main Component
**File:** `components/AIAssistantView.tsx`
- Mock mode is used only when the backend reports no configured key.
- All provider completions go through `services/aiAssistant.ts`.

### Settings Panel
**File:** `components/AIAssistantSettings.tsx`
- Administrator-only key entry, connection test and removal.
- The saved key is never returned to this component.

### Backend Proxy
**File:** `supabase/functions/ai-assistant/index.ts`
- Validates the staff session and AI Assistant permission.
- Encrypts/decrypts the provider key and applies per-user rate limits.

### Database
**Files:** `supabase/migrations/20261115000000_ai_assistant_secure_settings.sql`
and `database/ai_assistant_secure_settings.sql`
- Private schema, RLS, service-role-only RPCs and audit records.

### Frontend configuration
**File:** `vite.config.ts`
- Contains no AI credential injection. Never add one.

## Using the AI Assistant

### Example Questions You Can Ask:

1. **Treatment Protocols:**
   - "What's the complete protocol for a root canal treatment?"
   - "Crown preparation guidelines?"
   - "Extraction procedure for impacted wisdom tooth?"

2. **Pain Management:**
   - "How to manage acute dental pain?"
   - "Post-operative pain medications?"
   - "Dental emergency protocols?"

3. **Pediatric Care:**
   - "Cavity treatment for 5-year-old child?"
   - "Behavior management techniques?"
   - "Fluoride treatment guidelines?"

4. **Practice Insights:**
   - "Show me my recent patient records"
   - "Practice statistics summary"

### Tips for Best Results:

✅ **Be specific** - "Root canal for molar tooth" vs "dental treatment"
✅ **Provide context** - "55-year-old patient with severe pain"
✅ **Ask follow-ups** - Build on previous answers
✅ **Copy responses** - Use the copy button to save important guidance

## API Costs

**Gemini API Pricing (as of 2024):**
- **Free tier**: 60 requests per minute
- **Pro tier**: Pay-as-you-go for higher limits

For typical dental practice usage:
- **Estimated**: 100-300 requests per day
- **Cost**: Usually within free tier limits
- **Monitor**: Check usage at [apifree.ai](https://apifree.ai)

## Support & Resources

- **API Provider**: https://apifree.ai
- **Status Page**: Check provider website

## Future Enhancements (Coming Soon)

- 🔄 Conversation history persistence
- 📎 Attach patient records to queries
- 🖼️ Image analysis (X-rays, clinical photos)
- 🎙️ Voice input support
- 📊 Treatment plan generation
- 🔗 Integration with patient files

---

**Need Help?**
If you encounter any issues, check the troubleshooting section above or refer to the inline comments in `components/AIAssistantView.tsx`.
