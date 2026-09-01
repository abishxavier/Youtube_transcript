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
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
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
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
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
      signal: AbortSignal.timeout(6000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        return captionTracks;
      }
    }
  } catch (err) {
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
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(5000),
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
 * Fetch and parse raw timedtext XML (srv3 and classic format)
 */
async function fetchTimedText(baseUrl) {
  try {
    const res = await fetch(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)'
      },
      signal: AbortSignal.timeout(8000),
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
 * for contextual authentic translation.
 */
function groupSubtitlesIntoSentences(segments, maxWordsPerSentence = 25) {
  const groups = [];
  let currentGroup = {
    texts: [],
    segmentIndices: [],
    startTime: 0,
    endTime: 0
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (currentGroup.texts.length === 0) {
      currentGroup.startTime = seg.start;
    }
    currentGroup.texts.push(seg.originalText || seg.text);
    currentGroup.segmentIndices.push(i);
    currentGroup.endTime = seg.start + seg.duration;

    const combinedText = currentGroup.texts.join(' ');
    const wordCount = combinedText.split(/\s+/).length;
    const endsWithPunctuation = /[.?!।|]$/.test(seg.text.trim());

    if (endsWithPunctuation || wordCount >= maxWordsPerSentence || i === segments.length - 1) {
      groups.push({
        sentence: combinedText,
        segmentIndices: [...currentGroup.segmentIndices],
        startTime: currentGroup.startTime,
        endTime: currentGroup.endTime,
      });
      currentGroup = { texts: [], segmentIndices: [], startTime: 0, endTime: 0 };
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
 * Contextual Sentence-Level Translation
 * 1. Groups subtitle chunks into semantic sentences
 * 2. Translates full sentence for natural, authentic grammar & vocabulary
 * 3. Distributes translated text across segment timestamps proportionally
 */
async function translateContextualSentences(segments, targetLang, sourceLang = 'auto') {
  if (!segments || segments.length === 0) return [];
  if (targetLang === sourceLang || (targetLang === 'en' && sourceLang === 'auto')) {
    return segments;
  }

  // 1. Group segments into complete sentences
  const sentenceGroups = [];
  let currentGroup = { texts: [], indices: [] };

  for (let i = 0; i < segments.length; i++) {
    const text = (segments[i].originalText || segments[i].text || '').trim();
    if (!text) continue;

    currentGroup.texts.push(text);
    currentGroup.indices.push(i);

    const combined = currentGroup.texts.join(' ');
    const isPunctuation = /[.?!।|]$/.test(text);
    const wordCount = combined.split(/\s+/).length;

    if (isPunctuation || wordCount >= 18 || i === segments.length - 1) {
      sentenceGroups.push({
        sentence: combined,
        indices: [...currentGroup.indices],
      });
      currentGroup = { texts: [], indices: [] };
    }
  }

  const translatedSegments = segments.map(s => ({
    ...s,
    originalText: s.originalText || s.text,
  }));

  // 2. Batch pack sentences using newline delimiter (20 sentences per request)
  const BATCH_SENTENCES = 20;
  const batches = [];
  for (let i = 0; i < sentenceGroups.length; i += BATCH_SENTENCES) {
    batches.push(sentenceGroups.slice(i, i + BATCH_SENTENCES));
  }

  // Process with concurrency pool of 6 workers
  const CONCURRENCY = 6;
  let batchIndex = 0;

  async function worker() {
    while (batchIndex < batches.length) {
      const currentIdx = batchIndex++;
      const batch = batches[currentIdx];
      if (!batch) break;

      const combinedPayload = batch.map(b => b.sentence).join('\n');
      try {
        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(combinedPayload)}`;
        const res = await fetch(gUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data[0])) {
            const translatedFull = decodeHtmlEntities(data[0].map(s => s[0] || '').join(''));
            const translatedSentences = translatedFull.split('\n');

            batch.forEach((group, bIdx) => {
              const transSentence = (translatedSentences[bIdx] || group.sentence).trim();
              if (group.indices.length === 1) {
                translatedSegments[group.indices[0]].text = transSentence;
              } else {
                const words = transSentence.split(/\s+/);
                const numSegs = group.indices.length;
                const wordsPerSeg = Math.max(1, Math.ceil(words.length / numSegs));

                group.indices.forEach((segIdx, pos) => {
                  const startW = pos * wordsPerSeg;
                  const endW = pos === numSegs - 1 ? words.length : Math.min(words.length, (pos + 1) * wordsPerSeg);
                  const segWords = words.slice(startW, endW).join(' ');
                  if (segWords) {
                    translatedSegments[segIdx].text = segWords;
                  }
                });
              }
            });
            continue;
          }
        }
      } catch (err) {
        // Fallback below
      }

      // Fallback if newline batch failed
      for (const group of batch) {
        try {
          const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(group.sentence)}`;
          const res = await fetch(gUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            const data = await res.json();
            const translatedFull = decodeHtmlEntities(data?.[0]?.map(s => s[0] || '').join('') || group.sentence).trim();
            if (group.indices.length === 1) {
              translatedSegments[group.indices[0]].text = translatedFull;
            } else {
              const words = translatedFull.split(/\s+/);
              const numSegs = group.indices.length;
              const wordsPerSeg = Math.max(1, Math.ceil(words.length / numSegs));
              group.indices.forEach((segIdx, pos) => {
                const startW = pos * wordsPerSeg;
                const endW = pos === numSegs - 1 ? words.length : Math.min(words.length, (pos + 1) * wordsPerSeg);
                const segWords = words.slice(startW, endW).join(' ');
                if (segWords) translatedSegments[segIdx].text = segWords;
              });
            }
          }
        } catch (_) {}
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker());
  await Promise.all(workers);
  return translatedSegments;
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

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 0. Health Check Endpoint
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

    // Step 1: Extract Tracks via InnerTube/Web Scraper
    const captionTracks = await fetchCaptionsTrack(videoId);
    if (captionTracks && captionTracks.length > 0) {
      availableTracks = captionTracks.map(t => ({
        name: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
        languageCode: t.languageCode,
      }));

      // Find exact requested track, or pick the first authentic spoken track
      let targetTrack = null;
      if (requestedLang) {
        targetTrack = captionTracks.find(t => t.languageCode === requestedLang);
      }
      
      if (!targetTrack) {
        targetTrack = captionTracks[0];
      }

      if (targetTrack && targetTrack.baseUrl) {
        detectedSourceLang = targetTrack.languageCode || 'en';
        transcript = await fetchTimedText(targetTrack.baseUrl);
      }

      // If primary track timedtext failed, try any other available track
      if (!transcript || transcript.length === 0) {
        for (const trk of captionTracks) {
          if (trk.baseUrl && trk !== targetTrack) {
            transcript = await fetchTimedText(trk.baseUrl);
            if (transcript && transcript.length > 0) {
              detectedSourceLang = trk.languageCode || detectedSourceLang;
              break;
            }
          }
        }
      }
    }

    // Step 2: Fallback to YoutubeTranscript library across detected & default languages
    if (!transcript || transcript.length === 0) {
      const tryLangs = [requestedLang, detectedSourceLang, 'ta', 'hi', 'en', undefined].filter(Boolean);
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

    // If still no transcript found
    if (!transcript || transcript.length === 0) {
      return res.status(404).json({
        error: 'No captions or subtitles could be found for this video. The creator may not have enabled subtitles.',
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

    const videoInfo = await fetchVideoInfo(videoId);

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
    };

    if (transcriptCache.size > 500) {
      const firstKey = transcriptCache.keys().next().value;
      transcriptCache.delete(firstKey);
    }
    transcriptCache.set(cacheKey, payload);

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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Multilingual YouTube Transcriber & Player Server`);
  console.log(`🌐 Host Interface: 0.0.0.0:${PORT}`);
  console.log(`📱 Ready for Android / Google Play Store packaging`);
  console.log(`====================================================`);
});
