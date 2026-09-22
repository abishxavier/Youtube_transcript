/**
 * Audio Dubbing Manager: Real-time Video Voice Translation & Synchronized Playback
 * Provides dual-engine Text-to-Speech (HD Neural Audio & Browser Web Speech),
 * automatic video volume ducking, and millisecond-accurate playback synchronization.
 */

import { AppConfig } from './config.js';
import { fadeVolume, getVolume, setVolume, mute, unMute } from './player.js';

export class AudioDubbingManager {
  constructor() {
    // Configuration & State
    this.enabled = localStorage.getItem('AI_DUBBING_ENABLED') === 'true';
    this.mode = localStorage.getItem('AI_DUBBING_MODE') || 'ducking'; // 'ducking' | 'mute' | 'equal'
    this.engine = localStorage.getItem('AI_DUBBING_ENGINE') || 'neural'; // 'neural' | 'browser'
    this.volume = parseFloat(localStorage.getItem('AI_DUBBING_VOLUME') || '1.0');
    this.speed = parseFloat(localStorage.getItem('AI_DUBBING_SPEED') || '1.0');
    this.selectedVoiceURI = localStorage.getItem('AI_DUBBING_VOICE_URI') || '';

    this.targetLang = 'en';
    this.sourceLang = 'en';
    this.transcript = [];
    
    // Playback Tracking
    this.currentSpeakingIndex = -1;
    this.isSpeaking = false;
    this.lastCheckedTime = 0;
    this.isDucked = false;
    this.previousVideoVolume = 100;

    // Neural Audio Player & Cache
    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';
    this.audioElement.volume = this.volume;
    this.prefetchCache = new Map(); // index -> ObjectURL

    // Callbacks
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onStatusChange = null;
    this.onVoicesLoaded = null;

    this.initAudioListeners();
    this.initBrowserVoices();
  }

  /**
   * Initialize Audio Element Event Listeners
   */
  initAudioListeners() {
    this.audioElement.addEventListener('play', () => {
      this.isSpeaking = true;
      this.applyDucking();
      this.notifyStatus();
    });

    this.audioElement.addEventListener('ended', () => {
      this.handleSpeechEnded();
    });

    this.audioElement.addEventListener('error', (e) => {
      console.warn('[Dubber] Neural audio playback error, falling back to Web Speech:', e);
      // If neural stream fails, fallback to browser TTS for this segment
      if (this.currentSpeakingIndex >= 0 && this.transcript[this.currentSpeakingIndex]) {
        this.speakWithWebSpeech(this.transcript[this.currentSpeakingIndex].text, this.currentSpeakingIndex);
      } else {
        this.handleSpeechEnded();
      }
    });
  }

  /**
   * Initialize and pre-load browser voices
   */
  initBrowserVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        if (this.onVoicesLoaded) {
          this.onVoicesLoaded(this.getAvailableVoices(this.targetLang));
        }
      };
    }
  }

  /**
   * Set Dubbing Master Switch
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    localStorage.setItem('AI_DUBBING_ENABLED', this.enabled ? 'true' : 'false');
    
    if (!this.enabled) {
      this.stopSpeech();
      this.restoreVolume();
    }
    this.notifyStatus();
  }

  /**
   * Set Audio Mode ('ducking' = 15% original, 'mute' = 0% original, 'equal' = 50% original)
   */
  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('AI_DUBBING_MODE', mode);
    if (this.isSpeaking) {
      this.applyDucking();
    } else {
      this.restoreVolume();
    }
    this.notifyStatus();
  }

  /**
   * Set Voice Engine ('neural' | 'browser')
   */
  setEngine(engine) {
    this.engine = engine;
    localStorage.setItem('AI_DUBBING_ENGINE', engine);
    this.stopSpeech();
    this.notifyStatus();
  }

  /**
   * Set Dubbing Output Volume (0.0 to 1.0)
   */
  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, parseFloat(vol) || 1));
    localStorage.setItem('AI_DUBBING_VOLUME', this.volume);
    this.audioElement.volume = this.volume;
  }

  /**
   * Set Base Speech Speed (0.75 to 1.5)
   */
  setSpeed(spd) {
    this.speed = Math.max(0.75, Math.min(1.5, parseFloat(spd) || 1));
    localStorage.setItem('AI_DUBBING_SPEED', this.speed);
    this.audioElement.playbackRate = this.speed;
  }

  /**
   * Select specific browser voice URI
   */
  setVoiceURI(uri) {
    this.selectedVoiceURI = uri;
    localStorage.setItem('AI_DUBBING_VOICE_URI', uri);
  }

  /**
   * Update active transcript and target language
   */
  updateContext(transcript, targetLang, sourceLang = 'en') {
    this.stopSpeech();
    this.clearPrefetchCache();
    this.transcript = Array.isArray(transcript) ? transcript : [];
    this.targetLang = targetLang || 'en';
    this.sourceLang = sourceLang || 'en';
    this.currentSpeakingIndex = -1;
    this.notifyStatus();
  }

  /**
   * Get available browser voices for current language
   */
  getAvailableVoices(langCode) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return [];
    }
    const voices = window.speechSynthesis.getVoices() || [];
    const target = (langCode || this.targetLang || 'en').toLowerCase().split('-')[0];

    // Priority 1: Exact language match (e.g. 'ta-IN', 'hi-IN', 'es-ES')
    const exactMatches = voices.filter(v => v.lang.toLowerCase().startsWith(target));
    if (exactMatches.length > 0) return exactMatches;

    // Priority 2: Fallback to all voices
    return voices;
  }

  /**
   * Handle video time update from YouTube player
   */
  onPlaybackTimeUpdate({ currentTime, isPlaying, duration }) {
    if (!this.enabled || !this.transcript || this.transcript.length === 0) {
      return;
    }

    // If video is paused, pause dubbing
    if (!isPlaying) {
      if (this.isSpeaking) {
        this.pauseSpeech();
      }
      return;
    }

    // Detect seeking (large time gap > 1.8s)
    const timeDelta = Math.abs(currentTime - this.lastCheckedTime);
    const wasSeeking = timeDelta > 1.8;
    this.lastCheckedTime = currentTime;

    if (wasSeeking) {
      this.stopSpeech();
    }

    // Find segment matching current timestamp
    let foundIndex = -1;
    for (let i = 0; i < this.transcript.length; i++) {
      const cur = this.transcript[i];
      const next = this.transcript[i + 1];
      const endTime = next ? next.start : cur.start + (cur.duration || 3);

      if (currentTime >= cur.start && currentTime < endTime) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1 && currentTime < this.transcript[0].start) {
      return;
    }

    // If we've reached a new segment that hasn't been spoken yet
    if (foundIndex !== -1 && foundIndex !== this.currentSpeakingIndex) {
      const segment = this.transcript[foundIndex];
      // Only speak if segment has text
      if (segment && segment.text && segment.text.trim()) {
        this.speakSegment(segment, foundIndex);
        this.prefetchUpcomingSegments(foundIndex);
      }
    }
  }

  /**
   * Speak a specific segment in the target language
   */
  async speakSegment(segment, index, options = {}) {
    if (!segment || !segment.text) return;

    this.stopSpeech();
    this.currentSpeakingIndex = index;
    this.isSpeaking = true;

    const text = segment.text.trim();
    const duration = segment.duration || 3;

    // Calculate adaptive rate so sentence completes within subtitle timecode
    const words = text.split(/\s+/).length;
    const standardSeconds = words / 2.6; // approx 150 words per min
    let adaptiveRate = this.speed;
    if (duration > 0 && standardSeconds > duration) {
      const ratio = standardSeconds / duration;
      adaptiveRate = Math.min(1.45, Math.max(0.85, ratio * this.speed));
    }

    if (this.onSpeechStart) {
      this.onSpeechStart({ index, text, duration, rate: adaptiveRate });
    }
    this.notifyStatus();

    // Dual-Engine Dispatch
    if (this.engine === 'neural') {
      await this.speakWithNeuralAudio(text, index, adaptiveRate, options);
    } else {
      this.speakWithWebSpeech(text, index, adaptiveRate);
    }
  }

  /**
   * Engine 1: HD Neural AI Audio Stream from /api/tts
   */
  async speakWithNeuralAudio(text, index, rate = 1.0, options = {}) {
    try {
      this.applyDucking();

      // Check prefetch cache first
      let audioSrc = null;
      if (this.prefetchCache.has(index)) {
        audioSrc = this.prefetchCache.get(index);
      } else {
        const queryParams = new URLSearchParams({
          text,
          lang: this.targetLang || 'en',
          engine: 'google',
        });
        audioSrc = AppConfig.apiUrl(`/api/tts?${queryParams.toString()}`);
      }

      this.audioElement.src = audioSrc;
      this.audioElement.playbackRate = rate;
      this.audioElement.volume = this.volume;

      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        await playPromise.catch(err => {
          // If browser prevented auto-play or stream errored, fallback
          console.warn('[Dubber] Audio play prevented or failed:', err);
          if (!options.isManual) {
            this.speakWithWebSpeech(text, index, rate);
          }
        });
      }
    } catch (err) {
      console.warn('[Dubber] Neural audio failure, falling back to Web Speech:', err);
      this.speakWithWebSpeech(text, index, rate);
    }
  }

  /**
   * Engine 2: Browser Native SpeechSynthesis
   */
  speakWithWebSpeech(text, index, rate = 1.0) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.handleSpeechEnded();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      this.applyDucking();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.targetLang || 'en';
      utterance.rate = rate;
      utterance.volume = this.volume;

      // Select matching voice
      const voices = this.getAvailableVoices(this.targetLang);
      if (this.selectedVoiceURI) {
        const found = voices.find(v => v.voiceURI === this.selectedVoiceURI);
        if (found) utterance.voice = found;
      } else if (voices.length > 0) {
        utterance.voice = voices[0];
      }

      utterance.onend = () => {
        this.handleSpeechEnded();
      };

      utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[Dubber] Web Speech error:', e.error);
        }
        this.handleSpeechEnded();
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[Dubber] Web Speech invocation error:', err);
      this.handleSpeechEnded();
    }
  }

  /**
   * Prefetch upcoming segments in background for gapless playback
   */
  prefetchUpcomingSegments(currentIndex) {
    if (this.engine !== 'neural' || !this.transcript) return;

    // Prefetch next 2 segments
    for (let offset = 1; offset <= 2; offset++) {
      const nextIndex = currentIndex + offset;
      if (nextIndex < this.transcript.length && !this.prefetchCache.has(nextIndex)) {
        const nextSegment = this.transcript[nextIndex];
        if (nextSegment && nextSegment.text && nextSegment.text.trim()) {
          const query = new URLSearchParams({
            text: nextSegment.text.trim(),
            lang: this.targetLang || 'en',
            engine: 'google',
          });
          const url = AppConfig.apiUrl(`/api/tts?${query.toString()}`);
          
          fetch(url)
            .then(res => res.blob())
            .then(blob => {
              const objectUrl = URL.createObjectURL(blob);
              this.prefetchCache.set(nextIndex, objectUrl);
            })
            .catch(() => {});
        }
      }
    }
  }

  /**
   * Clear all prefetched audio blobs to free memory
   */
  clearPrefetchCache() {
    for (const [_, url] of this.prefetchCache) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }
    this.prefetchCache.clear();
  }

  /**
   * Stop all ongoing speech and restore original audio
   */
  stopSpeech() {
    this.isSpeaking = false;
    this.currentSpeakingIndex = -1;

    // Stop HTML Audio
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }

    // Stop Web Speech
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    this.restoreVolume();
    this.notifyStatus();
  }

  /**
   * Pause ongoing speech
   */
  pauseSpeech() {
    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
    }
    this.restoreVolume();
    this.notifyStatus();
  }

  /**
   * Handle completion of speech for active segment
   */
  handleSpeechEnded() {
    const finishedIndex = this.currentSpeakingIndex;
    this.isSpeaking = false;
    
    // Smoothly restore video audio when voice finishes
    this.restoreVolume();

    if (this.onSpeechEnd) {
      this.onSpeechEnd({ index: finishedIndex });
    }
    this.notifyStatus();
  }

  /**
   * Apply volume ducking to the YouTube video player
   */
  applyDucking() {
    if (!this.enabled) return;

    if (this.mode === 'mute') {
      fadeVolume(0, 150);
      this.isDucked = true;
    } else if (this.mode === 'ducking') {
      // Smart Voiceover broadcast ducking: video at 15%
      fadeVolume(15, 200);
      this.isDucked = true;
    } else if (this.mode === 'equal') {
      fadeVolume(50, 200);
      this.isDucked = true;
    }
  }

  /**
   * Restore video player volume to standard level
   */
  restoreVolume() {
    if (this.isDucked) {
      fadeVolume(100, 250);
      this.isDucked = false;
    }
  }

  /**
   * Test current voice settings with a sample phrase
   */
  async testVoice(sampleText = null) {
    const text = sampleText || `This is a live test of the translated audio voice in ${this.targetLang}.`;
    this.stopSpeech();
    this.isSpeaking = true;
    this.notifyStatus();

    if (this.engine === 'neural') {
      await this.speakWithNeuralAudio(text, -999, this.speed, { isManual: true });
    } else {
      this.speakWithWebSpeech(text, -999, this.speed);
    }
  }

  /**
   * Notify status listeners
   */
  notifyStatus() {
    if (this.onStatusChange) {
      this.onStatusChange({
        enabled: this.enabled,
        mode: this.mode,
        engine: this.engine,
        isSpeaking: this.isSpeaking,
        currentIndex: this.currentSpeakingIndex,
        currentText: (this.currentSpeakingIndex >= 0 && this.transcript[this.currentSpeakingIndex])
          ? this.transcript[this.currentSpeakingIndex].text
          : '',
        volume: this.volume,
        speed: this.speed,
        targetLang: this.targetLang,
      });
    }
  }
}
