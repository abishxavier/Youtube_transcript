import { AppConfig } from './config.js';

export class SummaryService {
  /**
   * Request or calculate summary for transcript
   */
  static async generateSummary(transcript, videoTitle = '', language = 'en') {
    if (!transcript || transcript.length === 0) {
      throw new Error('No transcript available to summarize');
    }

    try {
      const res = await fetch(AppConfig.apiUrl('/api/summarize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, videoTitle, language }),
      });

      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Backend summarize failed, using client-side summary:', e);
    }

    // Client-side fallback summarizer
    const fullText = transcript.map(t => t.text).join(' ');
    const totalWords = fullText.split(/\s+/).length;
    const sentences = fullText.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 25);

    const step = Math.max(1, Math.floor(sentences.length / 5));
    const keyTakeaways = [];
    for (let i = 0; i < sentences.length && keyTakeaways.length < 5; i += step) {
      keyTakeaways.push(sentences[i].trim());
    }

    return {
      title: videoTitle || 'Video Summary',
      totalWords,
      estimatedReadingTime: `${Math.ceil(totalWords / 200)} min read`,
      keyTakeaways: keyTakeaways.length > 0 ? keyTakeaways : [fullText.slice(0, 300) + '...'],
      overview: sentences.slice(0, 3).join(' ') || fullText.slice(0, 350),
    };
  }
}
