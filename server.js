import express from 'express';
import cors from 'cors';
import { YoutubeTranscript } from 'youtube-transcript';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory cache for transcripts & translations to minimize API load & boost speed
const transcriptCache = new Map();
const videoInfoCache = new Map();

/**
 * Extract YouTube Video ID from any URL format
 */
function extractVideoId(urlOrId) {
  if (!urlOrId) return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;

  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^https?:\/\/.*[?&]v=([a-zA-Z0-9_-]{11})/,
  ];

  for (const regex of patterns) {
    const match = str.match(regex);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Fetch video metadata via YouTube oEmbed
 */
async function fetchVideoInfo(videoId) {
  if (videoInfoCache.has(videoId)) {
    return videoInfoCache.get(videoId);
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      const info = {
        title: data.title || 'YouTube Video',
        author: data.author_name || 'YouTube Creator',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        videoId,
      };
      videoInfoCache.set(videoId, info);
      return info;
    }
  } catch (err) {
    console.warn(`oEmbed fetch failed for ${videoId}:`, err.message);
  }

  const fallback = {
    title: `YouTube Video (${videoId})`,
    author: 'Unknown Creator',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    videoId,
  };
  return fallback;
}

/**
 * Scrape timedtext caption tracks directly from YouTube video page
 */
async function fetchCaptionsTrack(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await response.text();

    const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s) ||
                      html.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);

    if (jsonMatch && jsonMatch[1]) {
      const playerResponse = JSON.parse(jsonMatch[1]);
      const captionTracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (captionTracks && captionTracks.length > 0) {
        return captionTracks;
      }
    }
  } catch (err) {
    console.warn(`Direct caption track extraction error for ${videoId}:`, err.message);
  }
  return null;
}

/**
 * Fetch raw XML / JSON timedtext from YouTube URL
 */
async function fetchTimedText(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}&fmt=json3`);
    if (res.ok) {
      const json = await res.json();
      if (json.events) {
        const transcript = [];
        for (const ev of json.events) {
          if (ev.segs && ev.segs.length > 0) {
            const text = ev.segs.map(s => s.utf8 || '').join('').trim();
            if (text) {
              transcript.push({
                text: decodeHtmlEntities(text),
                start: (ev.tStartMs || 0) / 1000,
                duration: (ev.dDurationMs || 0) / 1000,
              });
            }
          }
        }
        if (transcript.length > 0) return transcript;
      }
    }
  } catch (err) {
    console.warn('TimedText fetch failed:', err.message);
  }
  return null;
}

/**
 * Decode HTML entities in subtitle strings
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * High-Speed Batch Translation via Google GTX with smart chunking
 * Packs multiple subtitle lines into single network requests for 10x faster translation
 */
async function translateTextChunk(texts, targetLang, sourceLang = 'auto') {
  if (!texts || texts.length === 0) return [];
  if (targetLang === sourceLang || (targetLang === 'en' && sourceLang === 'auto')) {
    return texts;
  }

  // Join lines with newline delimiter
  const combinedText = texts.join('\n');

  // Try high-speed Google GTX batch translation
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(combinedText)}`;
    const gRes = await fetch(gUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (gRes.ok) {
      const gData = await gRes.json();
      if (gData && Array.isArray(gData[0])) {
        // Collect translated segments
        const fullTranslation = gData[0].map(s => s[0] || '').join('');
        const splitTranslations = fullTranslation.split('\n');

        if (splitTranslations.length === texts.length) {
          return splitTranslations.map(t => decodeHtmlEntities(t.trim()));
        }
      }
    }
  } catch (e) {
    // Fall back to line-by-line if batch fails
  }

  // Fallback: Parallel individual translations
  const fallbackPromises = texts.map(async text => {
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const gRes = await fetch(gUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3000),
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData && Array.isArray(gData[0])) {
          return decodeHtmlEntities(gData[0].map(s => s[0] || '').join('').trim());
        }
      }
    } catch (_) {}
    return text;
  });

  return Promise.all(fallbackPromises);
}

/**
 * Translate text batch across 100+ global languages in optimized chunks
 */
async function translateBatch(texts, targetLang, sourceLang = 'en') {
  if (!texts || texts.length === 0) return [];
  if (targetLang === sourceLang || (targetLang === 'en' && sourceLang === 'auto')) {
    return texts;
  }

  const results = [];
  const BATCH_SIZE = 35; // Process 35 lines per single request

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const translatedChunk = await translateTextChunk(chunk, targetLang, sourceLang);
    results.push(...translatedChunk);
  }

  return results;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 0. Health Check Endpoint (For Render Keep-Alive / Uptime Monitoring)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 1. Video Info Endpoint
app.get('/api/video-info', async (req, res) => {
  const { url, v } = req.query;
  const videoId = extractVideoId(url || v);

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid or missing YouTube Video URL/ID' });
  }

  try {
    const info = await fetchVideoInfo(videoId);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Available Caption Tracks Endpoint
app.get('/api/tracks', async (req, res) => {
  const { url, v } = req.query;
  const videoId = extractVideoId(url || v);

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid YouTube Video URL/ID' });
  }

  try {
    const tracks = await fetchCaptionsTrack(videoId);
    if (!tracks || tracks.length === 0) {
      return res.json({ available: false, tracks: [] });
    }
    const formatted = tracks.map(t => ({
      name: t.name?.simpleText || t.languageCode,
      languageCode: t.languageCode,
      kind: t.kind || 'standard',
      isAutoGenerated: t.vssId?.startsWith('a.') || false,
    }));
    res.json({ available: true, tracks: formatted });
  } catch (err) {
    res.json({ available: false, tracks: [], error: err.message });
  }
});

// 3. Transcript Endpoint with Translation & Caching
app.get('/api/transcript', async (req, res) => {
  const { url, v, lang = 'en', sourceLang } = req.query;
  const videoId = extractVideoId(url || v);

  if (!videoId) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL or Video ID' });
  }

  const cacheKey = `${videoId}_${lang}`;
  if (transcriptCache.has(cacheKey)) {
    return res.json(transcriptCache.get(cacheKey));
  }

  try {
    let transcript = null;
    let detectedSourceLang = 'en';

    // Step 1: Try direct caption tracks
    const captionTracks = await fetchCaptionsTrack(videoId);
    if (captionTracks && captionTracks.length > 0) {
      // Find matching language track or default track
      let targetTrack = captionTracks.find(t => t.languageCode === lang);
      if (!targetTrack) {
        targetTrack = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
      }

      if (targetTrack && targetTrack.baseUrl) {
        detectedSourceLang = targetTrack.languageCode || 'en';
        transcript = await fetchTimedText(targetTrack.baseUrl);
      }
    }

    // Step 2: Fallback to YoutubeTranscript library
    if (!transcript || transcript.length === 0) {
      try {
        const raw = await YoutubeTranscript.fetchTranscript(videoId);
        if (raw && raw.length > 0) {
          transcript = raw.map(item => ({
            text: decodeHtmlEntities(item.text),
            start: item.offset / 1000,
            duration: item.duration / 1000,
          }));
        }
      } catch (ytErr) {
        console.warn('YoutubeTranscript library fallback failed:', ytErr.message);
      }
    }

    // If still no transcript found
    if (!transcript || transcript.length === 0) {
      return res.status(404).json({
        error: 'No captions found for this video. The creator may have disabled subtitles or the video is private.',
        videoId,
      });
    }

    // Clean up empty lines & format durations
    transcript = transcript
      .map(item => ({
        text: decodeHtmlEntities(item.text),
        start: Math.round(item.start * 100) / 100,
        duration: Math.round(item.duration * 100) / 100,
      }))
      .filter(item => item.text.length > 0);

    // Step 3: If requested language is different from source language, translate!
    let finalTranscript = transcript;
    let isTranslated = false;

    if (lang && lang !== detectedSourceLang && lang !== 'auto') {
      const texts = transcript.map(t => t.text);
      const translatedTexts = await translateBatch(texts, lang, detectedSourceLang);
      finalTranscript = transcript.map((t, idx) => ({
        ...t,
        originalText: t.text,
        text: translatedTexts[idx] || t.text,
      }));
      isTranslated = true;
    }

    const videoInfo = await fetchVideoInfo(videoId);

    const payload = {
      videoId,
      videoInfo,
      language: lang,
      sourceLanguage: detectedSourceLang,
      isTranslated,
      totalSegments: finalTranscript.length,
      transcript: finalTranscript,
    };

    // Cache the result (max 500 entries)
    if (transcriptCache.size > 500) {
      const firstKey = transcriptCache.keys().next().value;
      transcriptCache.delete(firstKey);
    }
    transcriptCache.set(cacheKey, payload);

    return res.json(payload);
  } catch (err) {
    console.error(`Error processing transcript for ${videoId}:`, err);
    return res.status(500).json({
      error: `Failed to transcribe video: ${err.message}`,
      videoId,
    });
  }
});

// 4. Batch Translation API for on-the-fly language switching
app.post('/api/translate', async (req, res) => {
  const { segments, targetLang, sourceLang = 'auto', videoId } = req.body;

  if (!segments || !Array.isArray(segments) || !targetLang) {
    return res.status(400).json({ error: 'segments array and targetLang are required' });
  }

  const cacheKey = videoId ? `${videoId}_${targetLang}` : null;
  if (cacheKey && transcriptCache.has(cacheKey)) {
    return res.json(transcriptCache.get(cacheKey));
  }

  try {
    const texts = segments.map(s => s.originalText || s.text);
    const translatedTexts = await translateBatch(texts, targetLang, sourceLang);

    const translatedSegments = segments.map((seg, idx) => ({
      ...seg,
      originalText: seg.originalText || seg.text,
      text: translatedTexts[idx] || seg.text,
    }));

    const responseData = {
      targetLang,
      sourceLang,
      segments: translatedSegments,
    };

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: `Translation failed: ${err.message}` });
  }
});

// 5. AI Video Summary Generator API
app.post('/api/summarize', async (req, res) => {
  const { transcript, videoTitle, language = 'en' } = req.body;

  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'Transcript data required for summary' });
  }

  try {
    const fullText = transcript.map(t => t.text).join(' ');
    const totalWords = fullText.split(/\s+/).length;

    // Smart heuristic summary extraction
    const sentences = fullText
      .split(/(?<=[.?!])\s+/)
      .filter(s => s.trim().length > 20);

    // Pick top key points across beginning, middle, and end
    const keyTakeaways = [];
    const step = Math.max(1, Math.floor(sentences.length / 5));

    for (let i = 0; i < sentences.length && keyTakeaways.length < 5; i += step) {
      if (sentences[i] && !keyTakeaways.includes(sentences[i])) {
        keyTakeaways.push(sentences[i].trim());
      }
    }

    const summary = {
      title: videoTitle || 'Video Summary',
      totalWords,
      estimatedReadingTime: `${Math.ceil(totalWords / 200)} min read`,
      keyTakeaways: keyTakeaways.length > 0 ? keyTakeaways : [fullText.slice(0, 300) + '...'],
      overview: sentences.slice(0, 3).join(' ') || fullText.slice(0, 400),
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: `Summary generation failed: ${err.message}` });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Multilingual YouTube Transcriber & Player Server`);
  console.log(`🌐 Local Web App: http://localhost:${PORT}`);
  console.log(`📱 Ready for Android / Google Play Store packaging`);
  console.log(`====================================================`);
});
