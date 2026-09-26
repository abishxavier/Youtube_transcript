/**
 * Transcriber Service: API Client, Subtitle Parsing, and Translation Manager
 */

import { AppConfig } from './config.js';

export class TranscriberService {
  constructor() {
    this.currentVideoId = null;
    this.currentData = null;
    this.activeLanguage = 'en';
    this.sourceLanguage = 'en';
    this.translationCache = new Map(); // lang -> segments
  }

  /**
   * Format seconds to HH:MM:SS or MM:SS
   */
  static formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const formattedMins = String(mins).padStart(2, '0');
    const formattedSecs = String(secs).padStart(2, '0');

    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${formattedMins}:${formattedSecs}`;
    }
    return `${formattedMins}:${formattedSecs}`;
  }

  /**
   * Format seconds to SRT format (00:00:00,000)
   */
  static formatSrtTime(seconds) {
    const totalMs = Math.round(seconds * 1000);
    const hrs = Math.floor(totalMs / 3600000);
    const mins = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;

    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /**
   * Format seconds to VTT format (00:00:00.000)
   */
  static formatVttTime(seconds) {
    return TranscriberService.formatSrtTime(seconds).replace(',', '.');
  }

  /**
   * Parse timedtext XML format (srv3 and classic) into standard segment objects
   */
  static parseTimedTextXml(xml) {
    if (!xml || typeof xml !== 'string') return [];
    const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    const segments = [];
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
      if (!text) text = inner.replace(/<[^>]+>/g, '');
      text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (text) {
        segments.push({
          text,
          start: Math.round((startMs / 1000) * 100) / 100,
          duration: Math.round((durMs / 1000) * 100) / 100,
        });
      }
    }
    if (segments.length > 0) return segments;

    const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
    let tMatch;
    while ((tMatch = textRegex.exec(xml)) !== null) {
      const text = tMatch[3]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (text) {
        segments.push({
          text,
          start: Math.round(parseFloat(tMatch[1]) * 100) / 100,
          duration: Math.round(parseFloat(tMatch[2]) * 100) / 100,
        });
      }
    }
    return segments;
  }

  /**
   * Extract Video ID from user input
   */
  static extractVideoId(urlOrId) {
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
   * Get user-configured Gemini API Key if any
   */
  static getGeminiApiKey() {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('GEMINI_API_KEY') || '';
    }
    return '';
  }

  /**
   * Get user-configured OpenAI API Key for Whisper transcription
   */
  static getOpenAiApiKey() {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('OPENAI_API_KEY') || '';
    }
    return '';
  }

  /**
   * Get preferred target language (defaults to 'auto' for original audio)
   */
  static getPreferredLanguage() {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('PREFERRED_LANGUAGE') || 'auto';
    }
    return 'auto';
  }

  /**
   * Safe JSON response parser that prevents "Unexpected end of JSON input" errors
   */
  static async safeParseResponse(res) {
    try {
      const text = await res.text();
      if (!text || !text.trim()) {
        return { data: null, error: `Server error (${res.status}: ${res.statusText || 'No response body'})` };
      }
      try {
        const json = JSON.parse(text);
        return { data: json, error: null };
      } catch (_) {
        const isHtml = text.includes('<!DOCTYPE') || text.includes('<html');
        return { 
          data: null, 
          error: isHtml 
            ? `Server error (${res.status}). The video may be unavailable or processing timed out.` 
            : text.slice(0, 200) 
        };
      }
    } catch (readErr) {
      return { data: null, error: `Connection failed: ${readErr.message}` };
    }
  }

  /**
   * Fetch Video Metadata
   */
  async fetchVideoInfo(videoId) {
    try {
      const res = await fetch(AppConfig.apiUrl(`/api/video-info?v=${videoId}`));
      const { data } = await TranscriberService.safeParseResponse(res);
      if (res.ok && data && !data.error) {
        return data;
      }
    } catch (_) {}
    return { title: 'YouTube Video', author: 'YouTube Creator', videoId };
  }

  /**
   * Clear all cached transcripts for previous video
   */
  clearCache() {
    this.translationCache.clear();
    this.currentData = null;
    this.currentVideoId = null;
  }

  /**
   * Fetch Transcript for Video (Auto-detects spoken audio language & handles preferred language)
   */
  async fetchTranscript(videoId, lang = 'auto', mode = 'contextual') {
    // If switching to a different video, immediately clear all old video caches
    if (this.currentVideoId !== videoId) {
      this.clearCache();
    }
    this.currentVideoId = videoId;
    this.activeLanguage = lang;

    const apiKey = TranscriberService.getGeminiApiKey();
    const openaiKey = TranscriberService.getOpenAiApiKey();
    const queryParams = new URLSearchParams({
      v: videoId,
      lang: lang || 'auto',
      mode: apiKey ? 'gemini' : mode,
    });

    if (apiKey) {
      queryParams.append('apiKey', apiKey);
    }
    if (openaiKey) {
      queryParams.append('openaiKey', openaiKey);
    }

    let res = await fetch(AppConfig.apiUrl(`/api/transcript?${queryParams.toString()}`));
    let { data, error: parseErr } = await TranscriberService.safeParseResponse(res);

    // 1. If server extracted tracks but needs client-side fetch due to cloud datacenter IP limits
    if (data && data.needsClientFetch && data.fallbackUrl) {
      try {
        let timedRes = await fetch(data.fallbackUrl).catch(() => null);
        if (!timedRes || !timedRes.ok) {
          timedRes = await fetch(AppConfig.apiUrl(`/api/timedtext-proxy?url=${encodeURIComponent(data.fallbackUrl)}`)).catch(() => null);
        }
        if (timedRes && timedRes.ok) {
          const text = await timedRes.text();
          let segments = [];
          if (text.startsWith('{')) {
            try {
              const j = JSON.parse(text);
              if (j.events) {
                segments = j.events
                  .filter(e => e.segs && Array.isArray(e.segs))
                  .map(e => ({
                    text: e.segs.map(s => s.utf8 || '').join('').trim(),
                    start: Math.round((e.tStartMs / 1000) * 100) / 100,
                    duration: Math.round(((e.dDurationMs || 2500) / 1000) * 100) / 100,
                  }))
                  .filter(s => s.text.length > 0);
              }
            } catch (_) {}
          }
          if (segments.length === 0) {
            segments = TranscriberService.parseTimedTextXml(text);
          }
          if (segments && segments.length > 0) {
            data.transcript = segments;
            data.isOriginal = true;
            data.isTranslated = false;
            delete data.needsClientFetch;
          }
        }
      } catch (cfErr) {
        console.warn('Client timedtext fetch note:', cfErr.message);
      }
    }

    // 2. Fallback: If server failed (404/500), try querying /api/tracks and fetching from client browser
    if (!res.ok || !data || !data.transcript || data.transcript.length === 0) {
      try {
        const tracksRes = await fetch(AppConfig.apiUrl(`/api/tracks?v=${videoId}`));
        const tracksData = await tracksRes.json();
        if (tracksData && tracksData.available && Array.isArray(tracksData.tracks) && tracksData.tracks.length > 0) {
          const targetTrack = (lang && lang !== 'auto' ? tracksData.tracks.find(t => t.languageCode === lang) : null) || tracksData.tracks[0];
          if (targetTrack && targetTrack.baseUrl) {
            let timedRes = await fetch(targetTrack.baseUrl).catch(() => null);
            if (!timedRes || !timedRes.ok) {
              timedRes = await fetch(AppConfig.apiUrl(`/api/timedtext-proxy?url=${encodeURIComponent(targetTrack.baseUrl)}`)).catch(() => null);
            }
            if (timedRes && timedRes.ok) {
              const text = await timedRes.text();
              const segments = TranscriberService.parseTimedTextXml(text);
              if (segments && segments.length > 0) {
                data = {
                  videoId,
                  transcript: segments,
                  language: targetTrack.languageCode || 'en',
                  sourceLanguage: targetTrack.languageCode || 'en',
                  isOriginal: true,
                  isTranslated: false,
                };
                res = { ok: true };
              }
            }
          }
        }
      } catch (_) {}
    }

    if (!res.ok || !data || !data.transcript || data.transcript.length === 0) {
      const errMessage = (data && (data.error || data.message)) || parseErr || 'Could not fetch transcript for this video';
      const err = new Error(errMessage);
      err._body = data || {};
      throw err;
    }

    // 3. If user requested translation to another language and captions are in source language
    if (lang && lang !== 'auto' && lang !== data.language) {
      try {
        const transRes = await fetch(AppConfig.apiUrl('/api/translate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments: data.transcript,
            targetLang: lang,
            sourceLang: data.sourceLanguage || data.language || 'en',
            mode,
            apiKey
          })
        });
        if (transRes.ok) {
          const transJson = await transRes.json();
          if (transJson.segments && transJson.segments.length > 0) {
            data.transcript = transJson.segments;
            data.language = lang;
            data.isTranslated = true;
            data.isOriginal = false;
          }
        }
      } catch (_) {}
    }

    this.currentData = data;
    this.sourceLanguage = data.sourceLanguage || 'en';
    this.activeLanguage = data.language || lang;

    // Cache the original and current transcript for this video
    if (data.isOriginal) {
      this.translationCache.set('orig', data.transcript);
      this.translationCache.set(this.sourceLanguage, data.transcript);
    } else {
      const originalSegments = data.transcript.map(s => ({
        ...s,
        text: s.originalText || s.text,
      }));
      this.translationCache.set('orig', originalSegments);
      this.translationCache.set(this.sourceLanguage, originalSegments);
    }
    this.translationCache.set(this.activeLanguage, data.transcript);
    return data;
  }

  /**
   * Switch Language using Authentic Contextual / AI Translation
   */
  async translateToLanguage(targetLang, mode = 'contextual') {
    if (!this.currentData || !this.currentData.transcript) {
      throw new Error('No transcript loaded yet');
    }

    // If switching back to source language
    if (targetLang === 'auto' || targetLang === this.sourceLanguage) {
      const orig = this.translationCache.get('orig') || this.translationCache.get(this.sourceLanguage);
      if (orig) {
        this.activeLanguage = this.sourceLanguage;
        this.currentData.transcript = orig;
        this.currentData.language = this.sourceLanguage;
        this.currentData.isOriginal = true;
        this.currentData.isTranslated = false;
        return this.currentData;
      }
    }

    if (this.translationCache.has(targetLang)) {
      this.activeLanguage = targetLang;
      this.currentData.transcript = this.translationCache.get(targetLang);
      this.currentData.language = targetLang;
      this.currentData.isOriginal = targetLang === this.sourceLanguage;
      this.currentData.isTranslated = targetLang !== this.sourceLanguage;
      return this.currentData;
    }

    const baseSegments = this.translationCache.get('orig') ||
                         this.translationCache.get(this.sourceLanguage) ||
                         this.currentData.transcript;

    const apiKey = TranscriberService.getGeminiApiKey();
    const res = await fetch(AppConfig.apiUrl('/api/translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: baseSegments,
        targetLang,
        sourceLang: this.sourceLanguage,
        videoId: this.currentVideoId,
        mode: apiKey ? 'gemini' : mode,
        apiKey: apiKey || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Translation failed');
    }

    const data = await res.json();
    this.activeLanguage = targetLang;
    this.currentData.transcript = data.segments;
    this.currentData.language = targetLang;
    this.currentData.isOriginal = targetLang === this.sourceLanguage;
    this.currentData.isTranslated = targetLang !== this.sourceLanguage;
    this.translationCache.set(targetLang, data.segments);

    return this.currentData;
  }
}
