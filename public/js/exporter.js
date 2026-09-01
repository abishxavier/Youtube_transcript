/**
 * Export Manager for Subtitles & Transcripts (SRT, VTT, TXT, JSON, PDF/Print)
 */
import { TranscriberService } from './transcriber.js';

export class Exporter {
  /**
   * Helper to trigger file download in browser
   */
  static triggerDownload(content, filename, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Export as SubRip (.SRT) format
   */
  static exportSRT(transcript, videoTitle = 'transcript', langCode = 'en') {
    if (!transcript || transcript.length === 0) return;

    let srtContent = '';
    transcript.forEach((item, index) => {
      const start = item.start;
      const end = item.start + (item.duration || 2.5);

      const startTimeStr = TranscriberService.formatSrtTime(start);
      const endTimeStr = TranscriberService.formatSrtTime(end);

      srtContent += `${index + 1}\n`;
      srtContent += `${startTimeStr} --> ${endTimeStr}\n`;
      srtContent += `${item.text}\n\n`;
    });

    const safeTitle = this.sanitizeFilename(videoTitle);
    this.triggerDownload(srtContent, `${safeTitle}_${langCode}.srt`, 'application/x-subrip;charset=utf-8');
  }

  /**
   * Export as WebVTT (.VTT) format
   */
  static exportVTT(transcript, videoTitle = 'transcript', langCode = 'en') {
    if (!transcript || transcript.length === 0) return;

    let vttContent = 'WEBVTT\n\n';
    transcript.forEach((item, index) => {
      const start = item.start;
      const end = item.start + (item.duration || 2.5);

      const startTimeStr = TranscriberService.formatVttTime(start);
      const endTimeStr = TranscriberService.formatVttTime(end);

      vttContent += `${index + 1}\n`;
      vttContent += `${startTimeStr} --> ${endTimeStr}\n`;
      vttContent += `${item.text}\n\n`;
    });

    const safeTitle = this.sanitizeFilename(videoTitle);
    this.triggerDownload(vttContent, `${safeTitle}_${langCode}.vtt`, 'text/vtt;charset=utf-8');
  }

  /**
   * Export as Plain Text (.TXT) with or without timestamps
   */
  static exportTXT(transcript, videoTitle = 'transcript', langCode = 'en', includeTimestamps = true) {
    if (!transcript || transcript.length === 0) return;

    let txtContent = `Transcript: ${videoTitle}\n`;
    txtContent += `Language: ${langCode.toUpperCase()}\n`;
    txtContent += `Exported: ${new Date().toLocaleString()}\n`;
    txtContent += '='.repeat(50) + '\n\n';

    if (includeTimestamps) {
      transcript.forEach((item) => {
        const timeStr = TranscriberService.formatTime(item.start);
        txtContent += `[${timeStr}] ${item.text}\n`;
      });
    } else {
      txtContent += transcript.map(item => item.text).join('\n\n');
    }

    const safeTitle = this.sanitizeFilename(videoTitle);
    const suffix = includeTimestamps ? 'timestamped' : 'plain';
    this.triggerDownload(txtContent, `${safeTitle}_${langCode}_${suffix}.txt`, 'text/plain;charset=utf-8');
  }

  /**
   * Export as Structured JSON (.JSON)
   */
  static exportJSON(transcript, videoInfo = {}, langCode = 'en') {
    if (!transcript || transcript.length === 0) return;

    const payload = {
      meta: {
        title: videoInfo.title || 'YouTube Video',
        author: videoInfo.author || '',
        videoId: videoInfo.videoId || '',
        language: langCode,
        totalSegments: transcript.length,
        exportedAt: new Date().toISOString(),
      },
      transcript: transcript.map((item, index) => ({
        index: index + 1,
        startSeconds: item.start,
        durationSeconds: item.duration,
        timestamp: TranscriberService.formatTime(item.start),
        text: item.text,
        originalText: item.originalText || item.text,
      })),
    };

    const safeTitle = this.sanitizeFilename(videoInfo.title || 'transcript');
    this.triggerDownload(
      JSON.stringify(payload, null, 2),
      `${safeTitle}_${langCode}.json`,
      'application/json;charset=utf-8'
    );
  }

  /**
   * Export / Print Formatted PDF view
   */
  static printFormatted(transcript, videoInfo = {}, langCode = 'en') {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print/export PDF');
      return;
    }

    const title = videoInfo.title || 'YouTube Video Transcript';
    const author = videoInfo.author ? `by ${videoInfo.author}` : '';

    let rowsHtml = '';
    transcript.forEach((item) => {
      rowsHtml += `
        <div style="display: flex; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
          <span style="font-family: monospace; font-weight: bold; color: #6366f1; width: 80px; flex-shrink: 0;">
            ${TranscriberService.formatTime(item.start)}
          </span>
          <span style="flex-grow: 1; color: #1e293b; line-height: 1.5;">
            ${item.text}
          </span>
        </div>
      `;
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title} - Transcript</title>
          <style>
            body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { color: #0f172a; margin-bottom: 4px; font-size: 24px; }
            .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h1>${title}</h1>
            <button onclick="window.print()" style="padding: 8px 16px; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Print / Save as PDF</button>
          </div>
          <div class="meta">${author} | Language: ${langCode.toUpperCase()} | Generated by YouTube Transcriber Pro</div>
          <div>${rowsHtml}</div>
          <script>
            setTimeout(() => { window.print(); }, 500);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  /**
   * Copy all text to clipboard
   */
  static async copyToClipboard(transcript, includeTimestamps = false) {
    if (!transcript || transcript.length === 0) return false;

    let textToCopy = '';
    if (includeTimestamps) {
      textToCopy = transcript
        .map(item => `[${TranscriberService.formatTime(item.start)}] ${item.text}`)
        .join('\n');
    } else {
      textToCopy = transcript.map(item => item.text).join(' ');
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      return true;
    } catch (e) {
      console.warn('Clipboard write failed:', e);
      return false;
    }
  }

  static sanitizeFilename(str) {
    return (str || 'video')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .slice(0, 50)
      .replace(/\s+/g, '_');
  }
}
