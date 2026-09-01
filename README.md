# 🌐 TranscribeX Pro - Multilingual YouTube Video Transcriber & Subtitle Player

An application that allows users to paste a YouTube link and instantly generate a full transcript of the video in 100+ languages, synchronized with real-time video playback, AI summary, and multi-format export (SRT, VTT, TXT, JSON, PDF).

---

## ✨ Features

- **⚡ Instant YouTube URL Processing**: Paste any standard, short, or embed YouTube video link.
- **🎬 Synchronized Video Player**: Embedded YouTube player synchronized with timestamps down to the millisecond.
- **🎯 Click-to-Seek**: Click any sentence or timestamp in the transcript to jump the video directly to that point.
- **🌍 100+ World Languages**: Translate full video transcripts into all major languages (Hindi, Spanish, French, German, Japanese, Arabic, Tamil, Russian, Portuguese, Telugu, etc.) with in-memory caching.
- **👥 Dual-Subtitle Mode**: View the original spoken language and translated subtitles side-by-side.
- **🔍 Instant Transcript Search**: Search keywords with live segment filtering.
- **🔊 Text-to-Speech (TTS)**: Listen to any translated line read aloud using native speech synthesis.
- **🤖 AI Video Summary**: Generate instant key takeaways, overview, word count, and reading time.
- **📥 Universal Download Center**:
  - **`.SRT`** (SubRip Subtitles for video editors like Premiere, CapCut, DaVinci)
  - **`.VTT`** (WebVTT standard)
  - **`.TXT`** (Timestamped or plain script text)
  - **`.JSON`** (Developer schema with start time & duration)
  - **`Print / PDF`** (Formatted document view)
  - **`Copy to Clipboard`** (1-click full text copy)
- **📱 Android App Ready**: Pre-configured with Capacitor for packaging into an Android `.apk` / `.aab`.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
Open your browser at: `http://localhost:3000`

---

## 📁 Project Structure

```
youtube-multilingual-transcriber/
├── package.json              # Node dependencies and scripts
├── server.js                 # Express backend proxy & translation engine
├── render.yaml               # Render cloud deployment blueprint
├── capacitor.config.json     # Android packaging configuration
├── PLAYSTORE_GUIDE.md        # Complete Play Store release & cost guide
├── README.md                 # Documentation
├── android/                  # Native Android Studio Project (Capacitor)
└── public/
    ├── index.html            # Main UI layout
    ├── style.css             # Glassmorphism dark theme & responsive styles
    └── js/
        ├── app.js            # Main application coordinator
        ├── config.js         # API endpoint & environment config
        ├── player.js         # YouTube IFrame API wrapper & time tracker
        ├── languages.js      # 100+ global languages database
        ├── transcriber.js    # API service & subtitle parser
        ├── exporter.js       # Download handlers for SRT/VTT/TXT/JSON/PDF
        └── summary.js        # AI Key Takeaways & Summary generator
```

---

## 📱 Mobile Android App

See [PLAYSTORE_GUIDE.md](PLAYSTORE_GUIDE.md) for full instructions on building and publishing to the Google Play Store.
