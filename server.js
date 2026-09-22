import express from 'express';
import cors from 'cors';
import { YoutubeTranscript } from 'youtube-transcript';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import ytdl from '@distube/ytdl-core';
import youtubedl from 'youtube-dl-exec';
import OpenAI from 'openai';
import { createReadStream, createWriteStream, writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Automatically load local .env file if present (Node.js 20.6+ native)
try {
  process.loadEnvFile();
} catch (_) {
  // Ignored in cloud environments (Render, Railway, etc.) where environment variables are injected directly
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Proxy support for cloud deployments (Render / AWS / Webshare)
const rawProxyEnv = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '';
const proxyUrls = rawProxyEnv
  ? rawProxyEnv.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const proxyAgents = proxyUrls.map(url => {
  const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `http://${url}`;
  return new ProxyAgent(normalized);
});

let proxyRotationIndex = 0;
function getActiveProxyAgent() {
  if (proxyAgents.length === 0) return null;
  const agent = proxyAgents[proxyRotationIndex % proxyAgents.length];
  proxyRotationIndex++;
  return agent;
}

/**
 * Universal YouTube Fetcher with automatic Proxy support & direct fallback
 */
async function fetchYouTube(url, options = {}) {
  const agent = getActiveProxyAgent();
  if (agent) {
    try {
      const res = await undiciFetch(url, { ...options, dispatcher: agent });
      if (res.ok) return res;
      // If proxy returns 429 / 403 on this specific request (e.g. timedtext), fallback to direct fetch
      console.warn(`[Proxy] Request returned ${res.status}, falling back to direct fetch...`);
    } catch (proxyErr) {
      console.warn(`[Proxy] Connection error (${proxyErr.message}), falling back to direct fetch...`);
    }
  }
  // Native direct fetch
  return fetch(url, options);
}

// In-memory cache capped to 40 items to strictly protect Render's 512MB RAM limit
const MAX_CACHE_ITEMS = 40;
const transcriptCache = new Map();
const videoInfoCache = new Map();

// In-memory TTS audio cache (bounded to 120 segments)
const MAX_TTS_CACHE_ITEMS = 120;
const ttsAudioCache = new Map();

function setBoundedCache(cache, key, value) {
  if (cache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, value);
}

function setTtsCache(key, buffer) {
  if (ttsAudioCache.size >= MAX_TTS_CACHE_ITEMS) {
    const oldestKey = ttsAudioCache.keys().next().value;
    ttsAudioCache.delete(oldestKey);
  }
  ttsAudioCache.set(key, buffer);
}

// Concurrency mutex: run max 1 Whisper audio processing job at a time to prevent RAM spikes
let isWhisperActive = false;
const whisperQueue = [];

async function acquireWhisperLock() {
  if (!isWhisperActive) {
    isWhisperActive = true;
    return;
  }
  await new Promise(resolve => whisperQueue.push(resolve));
}

function releaseWhisperLock() {
  if (whisperQueue.length > 0) {
    const next = whisperQueue.shift();
    next();
  } else {
    isWhisperActive = false;
  }
}

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
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const info = {
        title: data.title || 'YouTube Video',
        author: data.author_name || 'YouTube Creator',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        videoId,
      };
      setBoundedCache(videoInfoCache, videoId, info);
      return info;
    }
  } catch (err) {
    console.warn(`oEmbed fetch failed for ${videoId}:`, err.message);
  }

  const fallback = {
    title: `YouTube Video (${videoId})`,
    author: 'YouTube Creator',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    videoId,
  };
  return fallback;
}

/**
 * High-Reliability InnerTube API caption extractor (Android client context)
 * Bypasses HTML scraping bot checks and datacenter IP blocks.
 */
async function fetchInnerTubeCaptionTracks(videoId) {
  try {
    const resp = await fetchYouTube('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const playability = data?.playabilityStatus;
      if (playability && (playability.status === 'ERROR' || playability.status === 'LOGIN_REQUIRED')) {
        const reason = playability.reason || 'This video is unavailable';
        const unavailErr = new Error(`VIDEO_UNAVAILABLE: ${reason}`);
        unavailErr.isUnavailable = true;
        unavailErr.reason = reason;
        throw unavailErr;
      }
      const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        return captionTracks;
      }
    }
  } catch (err) {
    if (err.isUnavailable) throw err;
    console.warn(`InnerTube caption fetch error for ${videoId}:`, err.message);
  }
  return null;
}

/**
 * Scrape timedtext caption tracks directly from YouTube video page (Fallback)
 */
async function fetchCaptionsTrack(videoId) {
  // 1. Primary: InnerTube API
  const innerTracks = await fetchInnerTubeCaptionTracks(videoId);
  if (innerTracks && innerTracks.length > 0) {
    return innerTracks;
  }

  // 2. Secondary: Web page scrape
  try {
    const response = await fetchYouTube(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
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
 * Fast & High-Reliability Subtitle Extractor using yt-dlp metadata
 * Bypasses all YouTube bot checks, sign-in walls, and datacenter IP blocks.
 * Zero media download (skipDownload: true). Fast and memory-safe (~1-2 seconds).
 */
async function fetchCaptionsWithYtDlp(videoId, preferredLang = null) {
  try {
    console.log(`[yt-dlp Subtitles] Extracting captions metadata for ${videoId}...`);
    const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      skipDownload: true,
      noPlaylist: true,
      noCacheDir: true,
      extractorArgs: 'youtube:player_client=android',
    });

    const allSubs = { ...(info.automatic_captions || {}), ...(info.subtitles || {}) };
    const availableLangs = Object.keys(allSubs);
    if (availableLangs.length === 0) return null;

    let chosenLang = preferredLang && allSubs[preferredLang] ? preferredLang : null;
    if (!chosenLang) {
      const priorities = ['hi', 'en', 'es', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'gu', 'pa', 'fr', 'de', 'ja', 'ar', 'ru'];
      for (const p of priorities) {
        if (allSubs[p]) { chosenLang = p; break; }
      }
    }
    if (!chosenLang) chosenLang = availableLangs[0];

    const formats = allSubs[chosenLang];
    if (!formats || formats.length === 0) return null;

    // Prefer json3 format
    const format = formats.find(f => f.ext === 'json3') || formats.find(f => f.ext === 'vtt') || formats[0];
    if (!format || !format.url) return null;

    const res = await fetch(format.url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    if (format.ext === 'json3') {
      const json = await res.json();
      const segments = json.events
        ?.filter(e => e.segs && Array.isArray(e.segs))
        ?.map(e => {
          const text = e.segs.map(s => s.utf8 || '').join('').trim();
          return {
            text: decodeHtmlEntities(text.replace(/\n+/g, ' ')),
            start: Math.round((e.tStartMs / 1000) * 100) / 100,
            duration: Math.round(((e.dDurationMs || 2500) / 1000) * 100) / 100,
          };
        })
        ?.filter(s => s.text && s.text.length > 0);

      if (segments && segments.length > 0) {
        return {
          segments,
          language: chosenLang,
          title: info.title || null,
          author: info.uploader || info.channel || null,
          availableTracks: availableLangs.map(l => ({ languageCode: l, name: l })),
        };
      }
    }
  } catch (err) {
    console.warn(`[yt-dlp Subtitles] Extraction warning for ${videoId}:`, err.message);
  }
  return null;
}

/**
 * Fetch and parse raw timedtext XML (srv3 and classic format)
 */
async function fetchTimedText(baseUrl) {
  try {
    const res = await fetchYouTube(baseUrl, {
      headers: {
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml || xml.trim().length === 0) return null;

    // Parse srv3 format (<p t="ms" d="ms"><s>...</s></p>)
    const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    const results = [];

    while ((match = pRegex.exec(xml)) !== null) {
      const startMs = parseInt(match[1], 10);
      const durMs = parseInt(match[2], 10);
      const inner = match[3];
      let text = '';
      const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
      let sMatch;
      while ((sMatch = sRegex.exec(inner)) !== null) {
        text += sMatch[1];
      }
      if (!text) {
        text = inner.replace(/<[^>]+>/g, '');
      }
      text = decodeHtmlEntities(text).trim();
      if (text) {
        results.push({
          text,
          start: Math.round((startMs / 1000) * 100) / 100,
          duration: Math.round((durMs / 1000) * 100) / 100,
        });
      }
    }

    if (results.length > 0) return results;

    // Classic format fallback (<text start="s" dur="s">...</text>)
    const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
    let tMatch;
    while ((tMatch = textRegex.exec(xml)) !== null) {
      const text = decodeHtmlEntities(tMatch[3]).trim();
      if (text) {
        results.push({
          text,
          start: Math.round(parseFloat(tMatch[1]) * 100) / 100,
          duration: Math.round(parseFloat(tMatch[2]) * 100) / 100,
        });
      }
    }

    if (results.length > 0) return results;
  } catch (err) {
    console.warn('TimedText fetch/parse failed:', err.message);
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
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#([0-9]{1,6});/g, (match, numStr) => String.fromCharCode(parseInt(numStr, 10)))
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Group fragmented subtitle lines into complete grammatical sentences
 * for contextual authentic translation (கோர்வையான மொழிபெயர்ப்பு).
 * Ensures sentences are never severed across prepositions, conjunctions, or dangling particles.
 */
function groupSubtitlesIntoSentences(segments) {
  const groups = [];
  let currentGroup = {
    texts: [],
    startTime: 0,
    endTime: 0
  };

  // Trailing particles / prepositions / conjunctions that should NEVER end a sentence
  const danglingEndRegex = /(?:के|का|की|में|से|पर|को|ने|और|या|लेकिन|कि|तो|जो|जिसमें|जिसके|जिसकी|जिसका|जिसने|जिससे|जिसपे|जिसपर|एंड|सो|अगर|तब|भी|वाला|वाली|वाले|काइंड|ஆஃப்|नहीं|of|in|to|for|with|on|at|from|by|about|as|into|like|through|after|over|between|out|against|during|without|before|under|around|among|and|but|or|nor|yet|so|that|which|who|whom|whose|where|when|why|how|because|since|although|though|while|if|unless|until|a|an|the)$/i;

  // Hindi sentence-ending verb forms
  const hindiSentenceEndRegex = /(?:है|हैं|था|थी|थे|होगा|होगी|होंगे|चाहिए|सकता|सकती|सकते|गया|गई|गए|लिया|दिया|किया|रहा|रही|रहे|पड़ता|पड़ती|पड़ते|होगी|होगा|करते|करता|करती|देखनी|देखना|देखने)$/i;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = (seg.originalText || seg.text || '').trim();
    if (!text) continue;

    if (currentGroup.texts.length === 0) {
      currentGroup.startTime = seg.start;
    }
    currentGroup.texts.push(text);
    currentGroup.endTime = seg.start + (seg.duration || 2);

    const combinedText = currentGroup.texts.join(' ');
    const wordCount = combinedText.split(/\s+/).length;

    // Check if the current chunk ends with strong punctuation
    const hasPunctuation = /[.?!।|\n]$/.test(text);
    const endsWithDangling = danglingEndRegex.test(text.replace(/[.?!।|]$/, '').trim());
    const endsWithHindiVerb = hindiSentenceEndRegex.test(text.replace(/[.?!।|]$/, '').trim());

    let shouldSplit = false;

    if (i === segments.length - 1) {
      // End of transcript
      shouldSplit = true;
    } else if (hasPunctuation) {
      // Real punctuation found: split unless it's too short (e.g. < 6 words) and not at end
      if (wordCount >= 6 || i === segments.length - 1) {
        shouldSplit = true;
      }
    } else if (wordCount >= 20 && !endsWithDangling && (endsWithHindiVerb || wordCount >= 32)) {
      // Natural clause boundary reached and not dangling
      shouldSplit = true;
    }

    if (shouldSplit) {
      groups.push({
        sentence: combinedText,
        startTime: Math.round(currentGroup.startTime * 100) / 100,
        endTime: Math.round(currentGroup.endTime * 100) / 100,
      });
      currentGroup = { texts: [], startTime: 0, endTime: 0 };
    }
  }

  // If any dangling text remains
  if (currentGroup.texts.length > 0) {
    if (groups.length > 0) {
      const last = groups[groups.length - 1];
      last.sentence += ' ' + currentGroup.texts.join(' ');
      last.endTime = Math.round(currentGroup.endTime * 100) / 100;
    } else {
      groups.push({
        sentence: currentGroup.texts.join(' '),
        startTime: Math.round(currentGroup.startTime * 100) / 100,
        endTime: Math.round(currentGroup.endTime * 100) / 100,
      });
    }
  }

  return groups;
}

/**
 * Authentic AI Translation via Google Gemini API
 */
async function translateWithGemini(fullTranscript, sourceLang, targetLang, apiKey) {
  const activeKey = apiKey || process.env.GEMINI_API_KEY;
  if (!activeKey) {
    throw new Error('No Gemini API Key provided');
  }

  // Group into sentence chunks of max 40 segments to avoid token limit and maintain context
  const CHUNK_SIZE = 40;
  const translatedSegments = [...fullTranscript];

  for (let i = 0; i < fullTranscript.length; i += CHUNK_SIZE) {
    const slice = fullTranscript.slice(i, i + CHUNK_SIZE);
    const inputLines = slice.map((s, idx) => `${idx + 1}. ${s.originalText || s.text}`).join('\n');

    const prompt = `You are a professional, native-speaking multilingual translator. 
Translate the following subtitle lines from ${sourceLang} to ${targetLang}.

Rules:
1. Make the translation AUTHENTIC, natural, fluent, and culturally appropriate, matching how native speakers actually talk.
2. Maintain the context across sentences so that fragmented lines make complete grammatical sense in ${targetLang}.
3. Return ONLY a JSON array of strings corresponding to each numbered line in exact order.
Example format: ["Translated line 1", "Translated line 2"]

Lines to translate:
${inputLines}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (rawJson) {
      const parsedArray = JSON.parse(rawJson);
      if (Array.isArray(parsedArray)) {
        parsedArray.forEach((translatedText, idx) => {
          const globalIdx = i + idx;
          if (translatedSegments[globalIdx]) {
            translatedSegments[globalIdx] = {
              ...translatedSegments[globalIdx],
              originalText: translatedSegments[globalIdx].originalText || translatedSegments[globalIdx].text,
              text: translatedText.trim(),
            };
          }
        });
      }
    }
  }

  return translatedSegments;
}

/**
 * Contextual & Coherent Subtitle Translation Engine (கோர்வையான மொழிபெயர்ப்பு)
 * Groups fragmented speech into full grammatical sentences before translation.
 * Translates each full thought with complete context, preserving natural flow and meaning.
 */
async function translateContextualSentences(segments, targetLang, sourceLang = 'auto') {
  if (!segments || segments.length === 0) return [];
  if (targetLang === sourceLang) return segments;

  // 1. Group fragments into full coherent sentences
  const groups = groupSubtitlesIntoSentences(segments);

  // 2. Translate complete sentences with concurrency and retry protection
  const CONCURRENCY = 6;
  let sIdx = 0;
  const translatedSentences = new Array(groups.length);

  async function worker() {
    while (sIdx < groups.length) {
      const current = sIdx++;
      const item = groups[current];
      const sentenceText = item.sentence.trim();

      if (!sentenceText) {
        translatedSentences[current] = {
          start: item.startTime,
          duration: Math.max(1, Math.round((item.endTime - item.startTime) * 100) / 100),
          text: '',
          originalText: ''
        };
        continue;
      }

      const translatedText = await translateSentenceWithAPIs(sentenceText, sourceLang, targetLang);

      translatedSentences[current] = {
        start: item.startTime,
        duration: Math.max(1, Math.round((item.endTime - item.startTime) * 100) / 100),
        text: translatedText || sentenceText,
        originalText: sentenceText,
      };
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, groups.length) }, () => worker());
  await Promise.all(workers);

  return translatedSentences;
}

/**
 * Multi-API translation helper:
 * 1. MyMemory API  (cloud-friendly, free, no key needed)
 * 2. Google Translate free  (fallback)
 */
async function translateSentenceWithAPIs(text, sourceLang, targetLang) {
  const sl = (sourceLang === 'auto' || !sourceLang) ? 'en' : sourceLang;

  // --- API 1: MyMemory (most reliable on cloud IPs) ---
  try {
    const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${targetLang}`;
    const mmRes = await fetch(mmUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (mmRes.ok) {
      const mmData = await mmRes.json();
      const translated = mmData?.responseData?.translatedText;
      if (
        translated &&
        translated.trim().length > 0 &&
        !translated.toUpperCase().includes('MYMEMORY WARNING') &&
        mmData?.responseStatus === 200
      ) {
        return decodeHtmlEntities(translated.trim());
      }
    }
  } catch (mmErr) {
    console.warn('[MyMemory] Failed:', mmErr.message);
  }

  // --- API 2: Google Translate free (fallback) ---
  for (const client of ['dict-chrome-ex', 'gtx']) {
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${sl}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const gRes = await fetch(gUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        const resTrans = gData?.[0]?.map(s => s[0] || '').join('').trim();
        if (resTrans) return decodeHtmlEntities(resTrans);
      }
    } catch (gErr) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // All APIs failed — return null so caller can use original
  return null;
}

/**
 * Universal Authentic Translation Engine
 */
async function performAuthenticTranslation(segments, targetLang, sourceLang, mode = 'contextual', apiKey = null) {
  if (!segments || segments.length === 0) return [];
  if (targetLang === sourceLang || (targetLang === 'en' && sourceLang === 'auto')) {
    return segments;
  }

  // 1. If Gemini AI translation is requested or API key is present
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;
  if ((mode === 'gemini' || mode === 'ai') && geminiKey) {
    try {
      return await translateWithGemini(segments, sourceLang, targetLang, geminiKey);
    } catch (geminiErr) {
      console.warn('Gemini translation failed, falling back to Contextual Engine:', geminiErr.message);
    }
  }

  // 2. High-Quality Contextual Sentence-Level Neural Translation
  return await translateContextualSentences(segments, targetLang, sourceLang);
}

/**
 * Whisper AI Audio Transcription
 * Downloads YouTube audio using yt-dlp and transcribes using Groq Whisper Large V3 (100% Free) or OpenAI.
 * Called ONLY when no captions are available on the video.
 */
async function transcribeAudioWithWhisper(videoId, customApiKey, hintLanguage = null) {
  const activeKey = customApiKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!activeKey) {
    throw new Error('NO_AI_KEY');
  }

  // Queue to ensure only 1 audio download/whisper job runs at once
  await acquireWhisperLock();

  const isGroq = activeKey.startsWith('gsk_') || activeKey === process.env.GROQ_API_KEY;
  const client = new OpenAI({
    apiKey: activeKey,
    baseURL: isGroq ? 'https://api.groq.com/openai/v1' : undefined,
  });
  const model = isGroq ? 'whisper-large-v3' : 'whisper-1';
  const tmpFile = join(tmpdir(), `yt_audio_${videoId}_${Date.now()}.m4a`);

  try {
    console.log(`[Whisper] Downloading audio for ${videoId} using yt-dlp (memory-optimized)...`);
    try {
      await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
        format: 'ba[abr<=48]/ba[abr<=64]/ba/best',
        output: tmpFile,
        noPlaylist: true,
        noCacheDir: true,
        maxFilesize: '24M',
        extractorArgs: 'youtube:player_client=android',
      });
    } catch (dlErr) {
      console.warn(`[Whisper] yt-dlp direct failed (${dlErr.message}), trying streaming ytdl-core fallback...`);
      const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`).catch(() => null);
      if (!info) throw dlErr;
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      const audioFormat = audioFormats.find(f => f.container === 'mp4' || f.container === 'webm') || audioFormats[0];
      if (!audioFormat) throw dlErr;

      // Stream directly to file on disk to prevent RAM accumulation
      await new Promise((resolve, reject) => {
        const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
        const fileOut = createWriteStream(tmpFile);
        stream.pipe(fileOut);
        fileOut.on('finish', resolve);
        fileOut.on('error', reject);
        stream.on('error', reject);
      });
    }

    console.log(`[Whisper] Audio ready. Sending to ${isGroq ? 'Groq Whisper Large V3' : 'OpenAI Whisper'}...`);

    const whisperOptions = {
      file: createReadStream(tmpFile),
      model,
      response_format: 'verbose_json',
    };
    if (hintLanguage && /^[a-z]{2}$/.test(hintLanguage)) {
      whisperOptions.language = hintLanguage;
    }

    const whisperResp = await client.audio.transcriptions.create(whisperOptions);

    const segments = (whisperResp.segments || []).map(seg => ({
      text: decodeHtmlEntities(seg.text.trim()),
      start: Math.round(seg.start * 100) / 100,
      duration: Math.round((seg.end - seg.start) * 100) / 100,
    })).filter(s => s.text.length > 0);

    console.log(`[Whisper] Transcribed ${segments.length} segments for ${videoId}. Detected: ${whisperResp.language}`);
    return {
      segments,
      detectedLanguage: whisperResp.language || 'en',
    };
  } finally {
    releaseWhisperLock();
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch (_) {}
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 0. Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Safe Server Configuration Status (Safety: returns ONLY booleans, NEVER returns API keys)
app.get('/api/server-config', (req, res) => {
  res.json({
    hasGroqApiKey: Boolean(process.env.GROQ_API_KEY),
    hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
    hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
    hasTtsAudio: true,
  });
});

// Debug Endpoint for diagnosing Render network/IP responses
app.get('/api/debug', async (req, res) => {
  const { v } = req.query;
  const videoId = extractVideoId(v) || 'c8EZrrTEfmk';

  const testClients = [
    {
      name: 'ANDROID',
      userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
    },
    {
      name: 'ANDROID_VR',
      userAgent: 'com.google.android.apps.youtube.vr/1.56.21 (Linux; U; Android 12)',
      context: { client: { clientName: 'ANDROID_VR', clientVersion: '1.56.21', deviceMake: 'Oculus', deviceModel: 'Quest 2' } },
    },
    {
      name: 'IOS',
      userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
      context: { client: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2' } },
    },
    {
      name: 'WEB_EMBEDDED',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      context: { client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20240301.01.00' }, thirdParty: { embedUrl: `https://www.youtube.com/embed/${videoId}` } },
    },
    {
      name: 'TV_HTML5',
      userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0.3809.146 TV Safari/537.36',
      context: { client: { clientName: 'TVHTML5', clientVersion: '7.20240301.08.00' } },
    },
  ];

  const results = [];
  for (const c of testClients) {
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': c.userAgent,
        },
        body: JSON.stringify({
          context: c.context,
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(5000),
      });

      const data = await resp.json();
      const status = data?.playabilityStatus?.status;
      const reason = data?.playabilityStatus?.reason;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      results.push({
        client: c.name,
        httpStatus: resp.status,
        status,
        reason,
        tracksCount: tracks ? tracks.length : 0,
        track0Lang: tracks?.[0]?.languageCode,
      });
    } catch (e) {
      results.push({ client: c.name, error: e.message });
    }
  }

  // Also test embed page scraping with consent cookies
  try {
    const watchResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AwGgJlbiACGgYIgLCtpgY; PREF=tz=UTC&hl=en;',
      },
      signal: AbortSignal.timeout(6000),
    });
    const html = await watchResp.text();
    const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[1]);
      const tracks = json.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      results.push({
        client: 'WATCH_PAGE_SCRAPE',
        tracksCount: tracks ? tracks.length : 0,
        track0Lang: tracks?.[0]?.languageCode,
      });
    } else {
      results.push({ client: 'WATCH_PAGE_SCRAPE', status: 'no_json_match', htmlLen: html.length });
    }
  } catch (e) {
    results.push({ client: 'WATCH_PAGE_SCRAPE', error: e.message });
  }

  res.json({ videoId, timestamp: new Date().toISOString(), results });
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
      name: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
      languageCode: t.languageCode,
      kind: t.kind || 'standard',
      isAutoGenerated: t.vssId?.startsWith('a.') || false,
    }));
    res.json({ available: true, tracks: formatted });
  } catch (err) {
    res.json({ available: false, tracks: [], error: err.message });
  }
});

/**
 * Heuristically detect spoken language from video title, author, and description
 */
function detectLanguageFromMetadata(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/[\u0D00-\u0D7F]/.test(text) || t.includes('malayalam')) return 'ml';
  if (/[\u0B80-\u0BFF]/.test(text) || t.includes('tamil')) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(text) || t.includes('telugu')) return 'te';
  if (/[\u0C80-\u0CFF]/.test(text) || t.includes('kannada')) return 'kn';
  if (/[\u0900-\u097F]/.test(text) || t.includes('hindi')) return 'hi';
  if (/[\u0980-\u09FF]/.test(text) || t.includes('bengali') || t.includes('bangla')) return 'bn';
  if (/[\u0A00-\u0A7F]/.test(text) || t.includes('punjabi')) return 'pa';
  if (/[\u0600-\u06FF]/.test(text) || t.includes('arabic')) return 'ar';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text) || t.includes('japanese')) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text) || t.includes('korean')) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(text) || t.includes('chinese')) return 'zh';
  if (/[\u0400-\u04FF]/.test(text) || t.includes('russian')) return 'ru';
  if (t.includes('spanish') || t.includes('español')) return 'es';
  if (t.includes('french') || t.includes('français')) return 'fr';
  if (t.includes('german') || t.includes('deutsch')) return 'de';
  return null;
}

// 3. Transcript Endpoint (Detects Original Language & Provides Authentic Output)
app.get('/api/transcript', async (req, res) => {
  const { url, v, lang, mode = 'contextual', apiKey } = req.query;
  const videoId = extractVideoId(url || v);

  if (!videoId) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL or Video ID' });
  }

  const requestedLang = lang && lang !== 'auto' ? lang : null;
  const cacheKey = `${videoId}_${requestedLang || 'orig'}_${mode}`;

  if (transcriptCache.has(cacheKey)) {
    return res.json(transcriptCache.get(cacheKey));
  }

  try {
    let transcript = null;
    let detectedSourceLang = 'en';
    let availableTracks = [];
    let usedWhisper = false;

    // Pre-fetch video metadata for accurate language identification
    const videoInfo = await fetchVideoInfo(videoId).catch(() => ({
      title: 'YouTube Video',
      author: 'Creator',
      videoId,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    }));
    const metaTitle = `${videoInfo?.title || ''} ${videoInfo?.author || ''}`.trim();
    const guessedAudioLang = detectLanguageFromMetadata(metaTitle);

    // Step 1: Extract Tracks via InnerTube/Web Scraper
    let captionTracks = null;
    try {
      captionTracks = await fetchCaptionsTrack(videoId);
    } catch (trackErr) {
      if (trackErr.isUnavailable) {
        return res.status(404).json({
          error: `This YouTube video is unavailable (${trackErr.reason || 'Video unavailable or removed'}).`,
          videoId,
        });
      }
    }
    if (captionTracks && captionTracks.length > 0) {
      availableTracks = captionTracks.map(t => ({
        name: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
        languageCode: t.languageCode,
      }));

      // Determine the authentic primary audio source track
      let sourceTrack = null;
      if (guessedAudioLang) {
        sourceTrack = captionTracks.find(t => t.languageCode === guessedAudioLang);
      }
      if (!sourceTrack) {
        // Prefer creator/manual uploaded track over ASR auto-generated tracks
        sourceTrack = captionTracks.find(t => !t.vssId?.startsWith('a.') && t.kind !== 'asr');
      }
      if (!sourceTrack) {
        // Prefer common spoken languages over arbitrary alphabetical ASR (e.g. avoiding random 'ar')
        const commonDefaults = ['en', 'hi', 'ml', 'ta', 'te', 'kn', 'bn', 'es'];
        for (const cLang of commonDefaults) {
          const found = captionTracks.find(t => t.languageCode === cLang);
          if (found) { sourceTrack = found; break; }
        }
      }
      if (!sourceTrack) {
        sourceTrack = captionTracks[0];
      }

      detectedSourceLang = sourceTrack?.languageCode || guessedAudioLang || 'en';

      // Pick target track: exact requested language if exists, else sourceTrack
      let targetTrack = null;
      if (requestedLang) {
        targetTrack = captionTracks.find(t => t.languageCode === requestedLang);
      }
      if (!targetTrack) {
        targetTrack = sourceTrack;
      }

      if (targetTrack && targetTrack.baseUrl) {
        transcript = await fetchTimedText(targetTrack.baseUrl);
      }

      // If primary track timedtext failed, try any other available track
      if (!transcript || transcript.length === 0) {
        for (const trk of captionTracks) {
          if (trk.baseUrl && trk !== targetTrack) {
            transcript = await fetchTimedText(trk.baseUrl);
            if (transcript && transcript.length > 0) {
              break;
            }
          }
        }
      }
    }

    // Step 2: Fallback to YoutubeTranscript library across detected & default languages
    if (!transcript || transcript.length === 0) {
      // Build a deduplicated list from actual detected/requested values — no hardcoded languages
      const tryLangs = [...new Set(
        [requestedLang, guessedAudioLang, detectedSourceLang, 'en'].filter(Boolean)
      )];
      for (const tLang of tryLangs) {
        try {
          const raw = await YoutubeTranscript.fetchTranscript(videoId, tLang ? { lang: tLang } : undefined);
          if (raw && raw.length > 0) {
            transcript = raw.map(item => ({
              text: decodeHtmlEntities(item.text),
              start: item.offset / 1000,
              duration: item.duration / 1000,
            }));
            detectedSourceLang = raw[0]?.lang || tLang || detectedSourceLang;
            break;
          }
        } catch (ytErr) {
          // continue to next fallback
        }
      }
    }

    // Step 2.5: High-Reliability yt-dlp Subtitle Extraction (Bypasses Datacenter / Cloud Blocks)
    if (!transcript || transcript.length === 0) {
      try {
        const ytdlpSubs = await fetchCaptionsWithYtDlp(videoId, requestedLang || guessedAudioLang);
        if (ytdlpSubs && ytdlpSubs.segments && ytdlpSubs.segments.length > 0) {
          transcript = ytdlpSubs.segments;
          detectedSourceLang = ytdlpSubs.language || detectedSourceLang;
          if (ytdlpSubs.availableTracks && ytdlpSubs.availableTracks.length > 0) {
            availableTracks = ytdlpSubs.availableTracks;
          }
          console.log(`[yt-dlp Subtitles] Successfully extracted ${transcript.length} segments in ${detectedSourceLang}`);
        }
      } catch (ytdlpErr) {
        console.warn(`[yt-dlp Subtitles] Fallback error:`, ytdlpErr.message);
      }
    }

    // Step 3: Whisper AI Audio Transcription Fallback (when no captions exist)
    if (!transcript || transcript.length === 0) {
      const customAiKey = req.query.aiKey || req.query.groqKey || req.query.openaiKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;

      try {
        console.log(`[Whisper] No captions for ${videoId}. Falling back to Whisper AI...`);
        const whisperResult = await transcribeAudioWithWhisper(videoId, customAiKey, guessedAudioLang);
        transcript = whisperResult.segments;
        detectedSourceLang = whisperResult.detectedLanguage || guessedAudioLang || 'en';
        usedWhisper = true;
        console.log(`[Whisper] Got ${transcript.length} segments. Language: ${detectedSourceLang}`);
      } catch (whisperErr) {
        if (whisperErr.message === 'NO_AI_KEY' || whisperErr.message === 'NO_OPENAI_KEY') {
          return res.status(404).json({
            error: 'NO_CAPTIONS_AVAILABLE',
            message: 'This video has no captions and audio transcription could not be completed.',
            videoId,
          });
        }
        if (whisperErr.message.includes('unavailable') || whisperErr.message.includes('Private') || whisperErr.message.includes('ERROR: [youtube]')) {
          return res.status(404).json({
            error: 'This YouTube video is unavailable or has been removed/made private.',
            videoId,
          });
        }
        return res.status(500).json({
          error: `Audio transcription failed: ${whisperErr.message}`,
          videoId,
        });
      }
    }

    // If still no transcript after all fallbacks
    if (!transcript || transcript.length === 0) {
      return res.status(404).json({
        error: 'Could not transcribe this video. Please try a different video.',
        videoId,
      });
    }

    // Format & clean transcript lines
    transcript = transcript
      .map(item => ({
        text: decodeHtmlEntities(item.text),
        start: Math.round(item.start * 100) / 100,
        duration: Math.round(item.duration * 100) / 100,
      }))
      .filter(item => item.text && item.text.trim().length > 0);

    // Step 3: Authentic Translation (if requested language is different from original)
    let finalTranscript = transcript;
    let isTranslated = false;
    const targetLanguage = requestedLang || detectedSourceLang;

    if (requestedLang && requestedLang !== detectedSourceLang && requestedLang !== 'auto') {
      finalTranscript = await performAuthenticTranslation(
        transcript,
        requestedLang,
        detectedSourceLang,
        mode,
        apiKey
      );
      isTranslated = true;
    }

    const payload = {
      videoId,
      videoInfo,
      language: targetLanguage,
      sourceLanguage: detectedSourceLang,
      isOriginal: !isTranslated,
      isTranslated,
      availableTracks,
      totalSegments: finalTranscript.length,
      transcript: finalTranscript,
      transcriptionMethod: usedWhisper ? 'whisper' : (availableTracks.length > 0 ? 'captions' : 'library'),
    };

    setBoundedCache(transcriptCache, cacheKey, payload);

    return res.json(payload);
  } catch (err) {
    console.error(`Error processing transcript for ${videoId}:`, err);
    return res.status(500).json({
      error: `Failed to retrieve transcript: ${err.message}`,
      videoId,
    });
  }
});

// 4. Authentic Translation API for on-the-fly language switching
app.post('/api/translate', async (req, res) => {
  const { segments, targetLang, sourceLang = 'auto', videoId, mode = 'contextual', apiKey } = req.body;

  if (!segments || !Array.isArray(segments) || !targetLang) {
    return res.status(400).json({ error: 'segments array and targetLang are required' });
  }

  const cacheKey = videoId ? `${videoId}_${targetLang}_${mode}` : null;
  if (cacheKey && transcriptCache.has(cacheKey)) {
    return res.json(transcriptCache.get(cacheKey));
  }

  try {
    const translatedSegments = await performAuthenticTranslation(
      segments,
      targetLang,
      sourceLang,
      mode,
      apiKey
    );

    const responseData = {
      targetLang,
      sourceLang,
      mode,
      segments: translatedSegments,
    };

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: `Translation failed: ${err.message}` });
  }
});

// 5. AI Video Summary Generator API
app.post('/api/summarize', async (req, res) => {
  const { transcript, videoTitle, language = 'en', apiKey } = req.body;

  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'Transcript data required for summary' });
  }

  // 1. If Gemini AI is configured, generate human-grade AI summary
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const fullText = transcript.map(t => t.text).join(' ').slice(0, 15000);
      const prompt = `You are an expert AI summarizer. Provide a high-impact, authentic summary in ${language} for the following video transcript titled "${videoTitle}":

Transcript:
${fullText}

Return ONLY a valid JSON object with this exact structure:
{
  "title": "${videoTitle || 'Video Summary'}",
  "totalWords": ${fullText.split(/\s+/).length},
  "estimatedReadingTime": "2 min read",
  "overview": "Detailed 2-3 paragraph overview capturing the core ideas authentically...",
  "keyTakeaways": [
    "Key takeaway point 1",
    "Key takeaway point 2",
    "Key takeaway point 3",
    "Key takeaway point 4",
    "Key takeaway point 5"
  ]
}`;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawJson) {
          return res.json(JSON.parse(rawJson));
        }
      }
    } catch (aiErr) {
      console.warn('Gemini summary failed, falling back to heuristic:', aiErr.message);
    }
  }

  // 2. High-Accuracy Heuristic Summary Fallback
  try {
    const fullText = transcript.map(t => t.text).join(' ');
    const totalWords = fullText.split(/\s+/).length;

    const sentences = fullText
      .split(/(?<=[.?!।])\s+/)
      .filter(s => s.trim().length > 20);

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
      overview: sentences.slice(0, 4).join(' ') || fullText.slice(0, 450),
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: `Summary generation failed: ${err.message}` });
  }
});

// =========================================================================
// 6. AI Text-To-Speech (TTS) & Audio Dubbing Engine
// =========================================================================

/**
 * Normalize language code for Google Neural TTS
 */
function normalizeTTSLang(lang) {
  if (!lang || lang === 'auto') return 'en';
  const clean = lang.trim().toLowerCase();
  if (clean === 'zh' || clean === 'zh-cn' || clean === 'chinese') return 'zh-CN';
  if (clean === 'zh-tw') return 'zh-TW';
  if (clean === 'pt-br') return 'pt-BR';
  if (clean.includes('-')) return clean.split('-')[0];
  return clean;
}

/**
 * Break text into <= 180 character chunks for seamless Google TTS streaming
 */
function chunkTextForTTS(text, maxLength = 180) {
  if (!text || text.length <= maxLength) return [text.trim()];
  const sentences = text.match(/[^.!?।;\n]+[.!?।;\n]+|[^.!?।;\n]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if ((current + ' ' + trimmed).trim().length <= maxLength) {
      current = (current + ' ' + trimmed).trim();
    } else {
      if (current) chunks.push(current);
      if (trimmed.length > maxLength) {
        const words = trimmed.split(/\s+/);
        let wordChunk = '';
        for (const w of words) {
          if ((wordChunk + ' ' + w).trim().length <= maxLength) {
            wordChunk = (wordChunk + ' ' + w).trim();
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = w;
          }
        }
        current = wordChunk;
      } else {
        current = trimmed;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.trim()];
}

/**
 * Fetch a single audio segment chunk from Google Neural TTS
 */
async function fetchGoogleTTSChunk(chunk, lang) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://translate.google.com/',
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) {
    throw new Error(`Google TTS request failed with status ${res.status}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Primary TTS Endpoint: Streams MP3 audio in target language
 * GET /api/tts?text=...&lang=...&engine=...&voice=...
 */
app.get('/api/tts', async (req, res) => {
  const { text, lang = 'en', engine = 'google', voice = 'alloy', apiKey } = req.query;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text parameter is required' });
  }

  const cleanText = text.trim();
  const normalizedLang = normalizeTTSLang(lang);
  const cacheKey = `${engine}_${normalizedLang}_${voice}_${cleanText}`;

  // Check in-memory audio cache
  if (ttsAudioCache.has(cacheKey)) {
    const cachedBuffer = ttsAudioCache.get(cacheKey);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': cachedBuffer.length,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      'X-TTS-Cache': 'HIT',
    });
    return res.send(cachedBuffer);
  }

  try {
    // 1. OpenAI TTS Engine (if requested or configured)
    const activeOpenAiKey = apiKey || process.env.OPENAI_API_KEY;
    if (engine === 'openai' && activeOpenAiKey) {
      const openAiClient = new OpenAI({ apiKey: activeOpenAiKey });
      const openAiResp = await openAiClient.audio.speech.create({
        model: 'tts-1',
        voice: voice || 'alloy',
        input: cleanText.slice(0, 4096),
      });
      const audioBuffer = Buffer.from(await openAiResp.arrayBuffer());
      setTtsCache(cacheKey, audioBuffer);
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'public, max-age=86400',
        'Accept-Ranges': 'bytes',
        'X-TTS-Cache': 'MISS',
      });
      return res.send(audioBuffer);
    }

    // 2. High-Accuracy Google Neural TTS Stream (Free & Multilingual)
    const chunks = chunkTextForTTS(cleanText, 180);
    const audioBuffers = [];

    for (const chunk of chunks) {
      if (chunk.trim()) {
        const buf = await fetchGoogleTTSChunk(chunk, normalizedLang);
        audioBuffers.push(buf);
      }
    }

    if (audioBuffers.length === 0) {
      return res.status(400).json({ error: 'Failed to generate audio from given text' });
    }

    const combinedBuffer = Buffer.concat(audioBuffers);
    setTtsCache(cacheKey, combinedBuffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': combinedBuffer.length,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      'X-TTS-Cache': 'MISS',
    });
    return res.send(combinedBuffer);
  } catch (err) {
    console.error('[TTS] Audio generation error:', err.message);
    return res.status(500).json({ error: `TTS generation failed: ${err.message}` });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Multilingual YouTube Transcriber & Player Server`);
  console.log(`🌐 Host Interface: 0.0.0.0:${PORT}`);
  if (proxyAgents.length > 0) {
    console.log(`🔒 Proxy Active: ${proxyAgents.length} proxy endpoint(s) configured`);
  } else {
    console.log(`ℹ️  No HTTP_PROXY configured. Running direct connection.`);
  }
  console.log(`📱 Ready for Android / Google Play Store packaging`);
  console.log(`====================================================`);
});
