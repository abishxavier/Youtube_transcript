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
   * Fetch Video Metadata
   */
  async fetchVideoInfo(videoId) {
    const res = await fetch(AppConfig.apiUrl(`/api/video-info?v=${videoId}`));
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch video info');
    }
    return await res.json();
  }

  /**
   * Fetch Transcript for Video
   */
  async fetchTranscript(videoId, lang = 'en') {
    this.currentVideoId = videoId;
    this.activeLanguage = lang;

    const res = await fetch(AppConfig.apiUrl(`/api/transcript?v=${videoId}&lang=${lang}`));
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Could not fetch transcript for this video');
    }

    const data = await res.json();
    this.currentData = data;
    this.sourceLanguage = data.sourceLanguage || 'en';

    // Store in cache
    this.translationCache.set(lang, data.transcript);
    return data;
  }

  /**
   * Switch Language (Uses translation cache or backend batch translation)
   */
  async translateToLanguage(targetLang) {
    if (!this.currentData || !this.currentData.transcript) {
      throw new Error('No transcript loaded yet');
    }

    if (this.translationCache.has(targetLang)) {
      this.activeLanguage = targetLang;
      this.currentData.transcript = this.translationCache.get(targetLang);
      this.currentData.language = targetLang;
      return this.currentData;
    }

    const res = await fetch(AppConfig.apiUrl('/api/translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: this.currentData.transcript,
        targetLang,
        sourceLang: this.sourceLanguage,
        videoId: this.currentVideoId,
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
    this.translationCache.set(targetLang, data.segments);

    return this.currentData;
  }
}
