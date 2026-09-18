# Auto Dialer Setup Guide

## What you need (all free)
1. **Twilio account** — free trial gives you ~$15.50 credit (~1,200 mins of US calls)
2. **ngrok** — free tunnel so Twilio can reach your laptop
3. **Node.js** — already installed if you have other projects

---

## Step 1 — Install dependencies

```
cd C:\Users\Bas12\auto-dialer
npm install
```

---

## Step 2 — Create a free Twilio account

1. Go to https://www.twilio.com/try-twilio → sign up (free, no credit card needed for trial)
2. Verify your phone number during signup

---

## Step 3 — Get a free US phone number

1. In Twilio Console → Phone Numbers → Manage → Buy a Number
2. Search for US numbers, pick any free one (trial covers the cost)
3. Copy the number (e.g. +15551234567)

---

## Step 4 — Create an API Key

1. Twilio Console → Account → API Keys & Tokens → Create new API Key
2. Name it "dialer", type = Standard → Create
3. **Copy the SID (starts with SK) and Secret now — you won't see the secret again**

---

## Step 5 — Create a TwiML App

1. Twilio Console → Develop → Voice → Manage → TwiML Apps → Create TwiML App
2. Name: "Auto Dialer"
3. Voice → Request URL: **leave blank for now** (you'll fill it in after starting ngrok)
4. Save → copy the App SID (starts with AP)

---

## Step 6 — Configure your .env file

```
cp .env.example .env
```

Open `.env` and fill in:
```
TWILIO_ACCOUNT_SID=AC...    ← Account Dashboard, top of page
TWILIO_AUTH_TOKEN=...        ← Account Dashboard, click "show"
TWILIO_API_KEY=SK...         ← From Step 4
TWILIO_API_SECRET=...        ← From Step 4
TWILIO_TWIML_APP_SID=AP...  ← From Step 5
TWILIO_PHONE_NUMBER=+1...    ← Your Twilio number from Step 3
```

---

## Step 7 — Start ngrok (free tunnel)

1. Download ngrok: https://ngrok.com/download (free account)
2. In a new terminal:
```
ngrok http 3000
```
3. Copy the HTTPS URL shown (e.g. `https://abc123.ngrok.io`)

---

## Step 8 — Point your TwiML App at ngrok

1. Back in Twilio Console → TwiML Apps → your "Auto Dialer" app
2. Voice → Request URL: `https://abc123.ngrok.io/voice`  ← your ngrok URL + /voice
3. Method: HTTP POST → Save

---

## Step 9 — Start the dialer

```
npm start
```

Open http://localhost:3000 in your browser.

---

## Using the dialer

- **Add prospects** — click "+ Add" or import a CSV file
- **CSV format** — columns: `name`, `phone`, `company`, `email` (header row required)
- **Call** — select a prospect, click the green Call button (calls through your browser)
- **Log outcome** — after each call, pick: Answered / Voicemail / No Answer / Callback / Converted / DNC
- **Power Dial** — toggle on to auto-advance AND auto-dial the next prospect after logging
- **Next →** — skip to next prospect without logging

## Twilio trial limits

In trial mode, Twilio can ONLY call numbers you've verified in the console.
To call any number (for real cold calling): upgrade to a paid account.
Cost after free credit: ~$0.013/min = about $1.30/hour of calling.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Twilio not configured" | Check your .env file has all 6 values |
| Call connects but no audio | Check browser microphone permission |
| Twilio can't reach /voice | Make sure ngrok is running and TwiML App URL is set |
| "Unable to make call" | In Twilio trial: verify the destination number first |
