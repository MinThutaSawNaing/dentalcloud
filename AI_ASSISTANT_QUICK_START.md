# AI Clinical Assistant - Quick Start Guide

## ✅ Installation Complete!

Your AI Clinical Assistant is now integrated into DentalCloudPro and ready to use!

---

## 🚀 Where to Replace the AI API Key

### **Option 1: Using Mock Mode (No API Key Needed)**
The assistant works immediately with intelligent mock responses. You can start using it right away to:
- Test the interface
- See example responses
- Demonstrate to your team

### **Option 2: Enable Real AI (Recommended)**

#### **Step 1: Get an API key**
Visit: https://apifree.ai

#### **Step 2: Sign in as an administrator**
Open **Settings → AI Assistant**. This tab is administrator-only.

#### **Step 3: Save the shared key**
Enter the API key and model, then choose **Save**. The backend encrypts it before
storage. Every user and branch uses the same configuration, and no user has to
enter the key again.

#### **Step 4: Test the connection**
Choose **Test connection**. Mock mode stops as soon as a key is configured.

Do not place the key in `.env`, a `VITE_` variable, or a Docker build argument.

---

## 📍 Where to Find It

1. **Launch your app** (if not running):
   ```bash
   npm run dev
   ```

2. **Navigate in sidebar**:
   - Look for **"Operations"** section
   - Click **"AI Assistant"** (with ✨ Sparkles icon)

---

## 💡 Key Files Modified

| File | What Changed |
|------|--------------|
| `App.tsx` | Added navigation and routing for AI Assistant |
| `components/AIAssistantView.tsx` | **NEW** - Main AI Assistant component |
| `.env.example` | **NEW** - Template for environment variables |
| `AI_ASSISTANT_SETUP.md` | **NEW** - Complete setup documentation |

---

## 🔧 Code Locations for Customization

### **Settings Panel**
**File:** `components/AIAssistantSettings.tsx`
Administrator-only key entry, connection test and removal.

### **Frontend AI Client**
**File:** `services/aiAssistant.ts`
Calls the `ai-assistant` backend function. It never holds a provider key.

### **Backend Proxy**
**File:** `supabase/functions/ai-assistant/index.ts`
Checks the staff session and AI Assistant permission, decrypts the saved key
only while calling the provider, and enforces per-user rate limits.

### **Database Migration**
**File:** `database/ai_assistant_secure_settings.sql`
Creates the private encrypted storage and service-role-only RPCs.

---

## 🎯 Quick Test

1. **Open AI Assistant** in your app
2. **Ask a question**: "What's the protocol for root canal treatment?"
3. **See the response**:
   - Yellow banner = Mock mode (working!)
   - No banner = Real AI connected
   - Red banner = API key issue

---

## 📊 What You Can Ask

### Treatment Protocols
- "Root canal treatment steps?"
- "How to extract a molar tooth?"
- "Crown preparation guidelines?"

### Pain Management
- "Managing acute dental pain?"
- "Post-operative medications?"

### Pediatric Care
- "Cavity treatment for children?"
- "Behavior management techniques?"

### Practice Data
- "Show recent patient statistics"
- "Practice overview"

---

## 🔒 Security Reminder

✅ `.env` is already in `.gitignore` - your API key is safe!  
✅ Never commit API keys to version control  
✅ Keep your AI API key private  

---

## 📱 Need Help?

- **Full Documentation**: See `AI_ASSISTANT_SETUP.md`
- **API Issues**: Check apifree.ai status
- **Questions**: Review inline comments in `AIAssistantView.tsx`

---

## 🎉 You're All Set!

The AI Assistant is now part of your DentalCloudPro application. Start using it with mock responses immediately, or add your API key for full AI capabilities!

**Enjoy your new AI Clinical Assistant! 🦷✨**
