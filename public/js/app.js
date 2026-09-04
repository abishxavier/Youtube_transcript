/**
 * Main Application Coordinator
 */
import { LANGUAGES, REGIONS, getLanguageByCode, searchLanguages } from './languages.js';
import { loadVideo, seekTo, togglePlayPause } from './player.js';
import { TranscriberService } from './transcriber.js';
import { Exporter } from './exporter.js';
import { SummaryService } from './summary.js';

// Application State
const state = {
  currentVideoId: null,
  videoInfo: null,
  transcript: [],
  activeLanguage: 'auto',
  sourceLanguage: 'en',
  isOriginal: true,
  isTranslated: false,
  activeIndex: -1,
  autoScroll: true,
  dualSubtitleMode: false,
  readingMode: false,
  searchQuery: '',
  isPlaying: false,
};

const transcriber = new TranscriberService();

// DOM Elements Cache
let elements = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDOMElements();
  initLanguageSelectors();
  initSettings();
  bindEvents();
  checkUrlParams();
});

function cacheDOMElements() {
  elements = {
    // Input & Fetch
    urlInput: document.getElementById('youtube-url-input'),
    fetchBtn: document.getElementById('fetch-btn'),
    pasteBtn: document.getElementById('paste-btn'),
    demoButtons: document.querySelectorAll('.demo-pill'),
    statusAlert: document.getElementById('status-alert'),
    loadingSpinner: document.getElementById('loading-spinner'),

    // Main App Sections
    appContent: document.getElementById('app-content'),
    welcomeSection: document.getElementById('welcome-section'),
    videoContainer: document.getElementById('video-player-wrapper'),
    videoTitle: document.getElementById('video-title'),
    videoAuthor: document.getElementById('video-author'),

    // Badges & Toolbar Controls
    langSelectBtn: document.getElementById('lang-select-btn'),
    selectedLangBadge: document.getElementById('selected-lang-badge'),
    detectedAudioBadge: document.getElementById('detected-audio-badge'),
    transModeBadge: document.getElementById('trans-mode-badge'),
    langModal: document.getElementById('lang-modal'),
    closeLangModalBtn: document.getElementById('close-lang-modal'),
    langSearchInput: document.getElementById('lang-search-input'),
    langGrid: document.getElementById('lang-grid'),

    // Settings Modal
    settingsNavBtn: document.getElementById('settings-nav-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsModalBtn: document.getElementById('close-settings-modal'),
    prefLangSelect: document.getElementById('pref-lang-select'),
    geminiApiKeyInput: document.getElementById('gemini-api-key-input'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),

    // Dual Subtitle, Reading Mode & Auto-scroll Toggles
    dualSubToggle: document.getElementById('dual-sub-toggle'),
    readingModeToggle: document.getElementById('reading-mode-toggle'),
    autoScrollToggle: document.getElementById('auto-scroll-toggle'),
    searchTranscriptInput: document.getElementById('search-transcript-input'),

    // Transcript Container
    transcriptList: document.getElementById('transcript-list'),
    segmentCountBadge: document.getElementById('segment-count-badge'),
    activeTimeDisplay: document.getElementById('active-time-display'),

    // Modals & Action Buttons
    exportBtn: document.getElementById('export-btn'),
    exportModal: document.getElementById('export-modal'),
    closeExportModalBtn: document.getElementById('close-export-modal'),
    downloadSrtBtn: document.getElementById('download-srt-btn'),
    downloadVttBtn: document.getElementById('download-vtt-btn'),
    downloadTxtBtn: document.getElementById('download-txt-btn'),
    downloadJsonBtn: document.getElementById('download-json-btn'),
    printPdfBtn: document.getElementById('print-pdf-btn'),
    copyClipboardBtn: document.getElementById('copy-clipboard-btn'),

    // AI Summary
    summaryBtn: document.getElementById('summary-btn'),
    summaryModal: document.getElementById('summary-modal'),
    closeSummaryModalBtn: document.getElementById('close-summary-modal'),
    summaryContent: document.getElementById('summary-content'),

    // Toast
    toast: document.getElementById('toast'),
  };
}

function initSettings() {
  const preferredLang = TranscriberService.getPreferredLanguage();
  if (elements.prefLangSelect) {
    elements.prefLangSelect.value = preferredLang || 'auto';
  }
  const geminiKey = TranscriberService.getGeminiApiKey();
  if (elements.geminiApiKeyInput) {
    elements.geminiApiKeyInput.value = geminiKey || '';
  }
}

function bindEvents() {
  // Fetch transcript
  elements.fetchBtn.addEventListener('click', () => handleFetchVideo());
  elements.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleFetchVideo();
  });

  // Paste from clipboard button
  if (elements.pasteBtn) {
    elements.pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        elements.urlInput.value = text;
        showToast('Pasted from clipboard!', 'info');
        handleFetchVideo();
      } catch (err) {
        showToast('Please allow clipboard access', 'warning');
      }
    });
  }

  // Demo pills
  elements.demoButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const demoUrl = btn.getAttribute('data-url');
      if (demoUrl) {
        elements.urlInput.value = demoUrl;
        handleFetchVideo();
      }
    });
  });

  // Language Modal
  elements.langSelectBtn.addEventListener('click', () => {
    elements.langModal.classList.add('active');
    elements.langSearchInput.focus();
  });

  elements.closeLangModalBtn.addEventListener('click', () => {
    elements.langModal.classList.remove('active');
  });

  elements.langSearchInput.addEventListener('input', (e) => {
    renderLanguageOptions(e.target.value);
  });

  // Settings Modal
  if (elements.settingsNavBtn) {
    elements.settingsNavBtn.addEventListener('click', () => {
      initSettings();
      elements.settingsModal.classList.add('active');
    });
  }

  if (elements.closeSettingsModalBtn) {
    elements.closeSettingsModalBtn.addEventListener('click', () => {
      elements.settingsModal.classList.remove('active');
    });
  }

  if (elements.saveSettingsBtn) {
    elements.saveSettingsBtn.addEventListener('click', () => {
      const pref = elements.prefLangSelect.value;
      const key = elements.geminiApiKeyInput.value.trim();
      localStorage.setItem('PREFERRED_LANGUAGE', pref);
      localStorage.setItem('GEMINI_API_KEY', key);

      elements.settingsModal.classList.remove('active');
      showToast('Settings saved successfully!', 'success');

      // If video is loaded and user changed preference, translate
      if (state.currentVideoId) {
        handleLanguageChange(pref);
      }
    });
  }

  // Dual Subtitle Toggle
  elements.dualSubToggle.addEventListener('change', (e) => {
    state.dualSubtitleMode = e.target.checked;
    renderTranscript();
  });

  // Reading / Paragraph Mode Toggle
  if (elements.readingModeToggle) {
    elements.readingModeToggle.addEventListener('change', (e) => {
      state.readingMode = e.target.checked;
      renderTranscript();
    });
  }

  // Auto-scroll Toggle
  elements.autoScrollToggle.addEventListener('change', (e) => {
    state.autoScroll = e.target.checked;
  });

  // Search Transcript
  elements.searchTranscriptInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    filterTranscriptDisplay();
  });

  // Export Modal
  elements.exportBtn.addEventListener('click', () => {
    elements.exportModal.classList.add('active');
  });

  elements.closeExportModalBtn.addEventListener('click', () => {
    elements.exportModal.classList.remove('active');
  });

  // Download actions
  elements.downloadSrtBtn.addEventListener('click', () => {
    Exporter.exportSRT(state.transcript, state.videoInfo?.title, state.activeLanguage);
    showToast('Downloaded .SRT file!', 'success');
  });

  elements.downloadVttBtn.addEventListener('click', () => {
    Exporter.exportVTT(state.transcript, state.videoInfo?.title, state.activeLanguage);
    showToast('Downloaded .VTT file!', 'success');
  });

  elements.downloadTxtBtn.addEventListener('click', () => {
    Exporter.exportTXT(state.transcript, state.videoInfo?.title, state.activeLanguage, true);
    showToast('Downloaded .TXT file!', 'success');
  });

  elements.downloadJsonBtn.addEventListener('click', () => {
    Exporter.exportJSON(state.transcript, state.videoInfo, state.activeLanguage);
    showToast('Downloaded .JSON file!', 'success');
  });

  elements.printPdfBtn.addEventListener('click', () => {
    Exporter.printFormatted(state.transcript, state.videoInfo, state.activeLanguage);
  });

  elements.copyClipboardBtn.addEventListener('click', async () => {
    const success = await Exporter.copyToClipboard(state.transcript, false);
    if (success) {
      showToast('Copied full transcript to clipboard!', 'success');
    } else {
      showToast('Failed to copy', 'error');
    }
  });

  // AI Summary Modal
  elements.summaryBtn.addEventListener('click', () => handleGenerateSummary());
  elements.closeSummaryModalBtn.addEventListener('click', () => {
    elements.summaryModal.classList.remove('active');
  });

  // Close modals on background click
  window.addEventListener('click', (e) => {
    if (e.target === elements.langModal) elements.langModal.classList.remove('active');
    if (e.target === elements.settingsModal) elements.settingsModal.classList.remove('active');
    if (e.target === elements.exportModal) elements.exportModal.classList.remove('active');
    if (e.target === elements.summaryModal) elements.summaryModal.classList.remove('active');
  });
}

function initLanguageSelectors() {
  renderLanguageOptions();
  updateSelectedLanguageDisplay('auto');
}

function renderLanguageOptions(searchQuery = '') {
  const filtered = searchLanguages(searchQuery);
  elements.langGrid.innerHTML = '';

  if (filtered.length === 0) {
    elements.langGrid.innerHTML = `<div class="no-results">No languages found matching "${searchQuery}"</div>`;
    return;
  }

  // Group by regions
  const grouped = {};
  filtered.forEach(lang => {
    const r = lang.region || 'Other';
    if (!grouped[r]) grouped[r] = [];
    grouped[r].push(lang);
  });

  for (const [regionName, langs] of Object.entries(grouped)) {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'lang-region-header';
    groupHeader.textContent = regionName;
    elements.langGrid.appendChild(groupHeader);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'lang-sub-grid';

    langs.forEach(lang => {
      const isSelected = state.activeLanguage === lang.code;
      const btn = document.createElement('button');
      btn.className = `lang-card ${isSelected ? 'active' : ''}`;
      btn.innerHTML = `
        <span class="lang-flag">${lang.flag}</span>
        <div class="lang-text">
          <span class="lang-name">${lang.name}</span>
          <span class="lang-native">${lang.nativeName}</span>
        </div>
      `;

      btn.addEventListener('click', () => {
        handleLanguageChange(lang.code);
        elements.langModal.classList.remove('active');
      });

      groupGrid.appendChild(btn);
    });

    elements.langGrid.appendChild(groupGrid);
  }
}

async function handleFetchVideo() {
  const input = elements.urlInput.value.trim();
  const videoId = TranscriberService.extractVideoId(input);

  if (!videoId) {
    showStatusAlert('Please enter a valid YouTube video URL or ID.', 'error');
    return;
  }

  showLoading(true, 'Extracting authentic audio captions...');
  hideStatusAlert();

  try {
    const preferredLang = TranscriberService.getPreferredLanguage();

    // 1. Fetch metadata and transcript concurrently
    const [transcriptData, videoInfo] = await Promise.all([
      transcriber.fetchTranscript(videoId, preferredLang),
      transcriber.fetchVideoInfo(videoId).catch(() => ({ title: 'YouTube Video', author: 'YouTube Creator' })),
    ]);

    state.currentVideoId = videoId;
    state.videoInfo = videoInfo;
    state.transcript = transcriptData.transcript;
    state.sourceLanguage = transcriptData.sourceLanguage || 'en';
    state.activeLanguage = transcriptData.language || preferredLang;
    state.isOriginal = transcriptData.isOriginal !== false;
    state.isTranslated = transcriptData.isTranslated === true;

    // 2. Display Workspace & Transcript immediately
    elements.welcomeSection.style.display = 'none';
    elements.appContent.style.display = 'grid';
    elements.videoTitle.textContent = videoInfo.title;
    elements.videoAuthor.textContent = videoInfo.author ? `by ${videoInfo.author}` : '';
    elements.segmentCountBadge.textContent = `${state.transcript.length} lines`;

    // 3. Update Audio Language Badges
    const srcLangObj = getLanguageByCode(state.sourceLanguage);
    if (elements.detectedAudioBadge) {
      elements.detectedAudioBadge.textContent = `🎙️ Audio: ${srcLangObj.flag} ${srcLangObj.name}`;
      elements.detectedAudioBadge.title = `Original spoken audio in video is ${srcLangObj.name}`;
    }

    updateModeBadge();
    updateSelectedLanguageDisplay(state.activeLanguage);
    renderTranscript();
    showToast(`Loaded ${state.transcript.length} authentic transcript lines!`, 'success');

    // 4. Initialize YouTube Player in background (does not block transcript)
    loadVideo('youtube-player-iframe', videoId, {
      onTimeUpdate: (status) => handlePlaybackTimeUpdate(status),
      onReady: () => console.log('Player ready'),
    }).catch(playerErr => console.warn('Player load error:', playerErr));
  } catch (err) {
    console.error('Error fetching video transcript:', err);
    showStatusAlert(
      err.message || 'Could not load transcript for this video. Make sure subtitles are available on this video.',
      'error'
    );
  } finally {
    showLoading(false);
  }
}

async function handleLanguageChange(langCode) {
  if (state.activeLanguage === langCode && state.transcript.length > 0) return;

  const targetLangObj = getLanguageByCode(langCode);
  showLoading(true, `Generating authentic translation in ${targetLangObj.name}...`);

  try {
    const data = await transcriber.translateToLanguage(langCode);
    state.activeLanguage = langCode;
    state.transcript = data.transcript;
    state.isOriginal = data.isOriginal;
    state.isTranslated = data.isTranslated;

    updateModeBadge();
    updateSelectedLanguageDisplay(langCode);
    renderTranscript();
    renderLanguageOptions(elements.langSearchInput.value);
    showToast(`Translated authentically into ${targetLangObj.name}!`, 'success');
  } catch (err) {
    console.error('Translation error:', err);
    showToast(`Translation failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

function updateModeBadge() {
  if (!elements.transModeBadge) return;

  if (state.isOriginal || state.activeLanguage === state.sourceLanguage || state.activeLanguage === 'auto') {
    elements.transModeBadge.style.display = 'inline-block';
    elements.transModeBadge.textContent = '🎙️ Verbatim Original';
    elements.transModeBadge.className = 'badge badge-success';
  } else {
    elements.transModeBadge.style.display = 'inline-block';
    const isGemini = !!TranscriberService.getGeminiApiKey();
    elements.transModeBadge.textContent = isGemini ? '✨ Gemini AI Fluent' : '✨ Authentic Contextual AI';
    elements.transModeBadge.className = 'badge badge-primary';
  }
}

function updateSelectedLanguageDisplay(code) {
  if (code === 'auto') {
    const srcLang = getLanguageByCode(state.sourceLanguage);
    elements.selectedLangBadge.innerHTML = `🎙️ Original (${srcLang.name})`;
  } else {
    const lang = getLanguageByCode(code);
    elements.selectedLangBadge.innerHTML = `${lang.flag} ${lang.name} (${lang.nativeName})`;
  }
}

function renderTranscript() {
  elements.transcriptList.innerHTML = '';

  if (!state.transcript || state.transcript.length === 0) {
    elements.transcriptList.innerHTML = '<div class="empty-transcript">No transcript lines found.</div>';
    return;
  }

  // 1. Reading / Paragraph Mode
  if (state.readingMode) {
    renderParagraphReadingView();
    return;
  }

  // 2. Standard Subtitle Synced Rows
  state.transcript.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `transcript-row ${index === state.activeIndex ? 'active' : ''}`;
    row.id = `transcript-row-${index}`;
    row.setAttribute('data-index', index);
    row.setAttribute('data-start', item.start);

    const formattedTime = TranscriberService.formatTime(item.start);

    // Dual Subtitle text format if enabled
    let textHtml = `<p class="row-text main-sub">${escapeHtml(item.text)}</p>`;
    if (state.dualSubtitleMode && item.originalText && item.originalText !== item.text) {
      textHtml += `<p class="row-text original-sub">${escapeHtml(item.originalText)}</p>`;
    }

    row.innerHTML = `
      <div class="row-time-col">
        <button class="time-badge" title="Jump video to ${formattedTime}">
          <span class="play-icon">▶</span> ${formattedTime}
        </button>
      </div>
      <div class="row-content-col">
        ${textHtml}
      </div>
      <div class="row-actions-col">
        <button class="icon-action-btn speak-btn" title="Listen with Text-to-Speech">🔊</button>
        <button class="icon-action-btn copy-line-btn" title="Copy line">📋</button>
      </div>
    `;

    // Click on row / timestamp seeks video
    row.querySelector('.time-badge').addEventListener('click', (e) => {
      e.stopPropagation();
      seekTo(item.start);
    });

    row.addEventListener('click', () => {
      seekTo(item.start);
    });

    // Text to Speech
    row.querySelector('.speak-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      speakText(item.text, state.activeLanguage === 'auto' ? state.sourceLanguage : state.activeLanguage);
    });

    // Copy single line
    row.querySelector('.copy-line-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(`[${formattedTime}] ${item.text}`);
        showToast('Line copied to clipboard!', 'info');
      } catch (err) {
        showToast('Failed to copy', 'error');
      }
    });

    elements.transcriptList.appendChild(row);
  });
}

function renderParagraphReadingView() {
  const container = document.createElement('div');
  container.className = 'reading-paragraphs-container';
  container.style.cssText = 'padding: 1.25rem; line-height: 1.85; font-size: 1.05rem;';

  // Group every 6-8 items into a readable paragraph
  const PARAGRAPH_SIZE = 7;
  for (let i = 0; i < state.transcript.length; i += PARAGRAPH_SIZE) {
    const chunk = state.transcript.slice(i, i + PARAGRAPH_SIZE);
    const p = document.createElement('p');
    p.style.cssText = 'margin-bottom: 1.5rem; background: var(--bg-card); padding: 1rem 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);';

    const startTime = TranscriberService.formatTime(chunk[0].start);
    const timeBtn = document.createElement('button');
    timeBtn.className = 'time-badge';
    timeBtn.style.cssText = 'margin-right: 8px; vertical-align: middle; display: inline-flex;';
    timeBtn.innerHTML = `<span>▶</span> ${startTime}`;
    timeBtn.addEventListener('click', () => seekTo(chunk[0].start));

    p.appendChild(timeBtn);

    chunk.forEach(item => {
      const span = document.createElement('span');
      span.textContent = item.text + ' ';
      span.style.cursor = 'pointer';
      span.title = `Click to play from ${TranscriberService.formatTime(item.start)}`;
      span.addEventListener('click', () => seekTo(item.start));
      p.appendChild(span);
    });

    container.appendChild(p);
  }

  elements.transcriptList.appendChild(container);
}

function handlePlaybackTimeUpdate({ currentTime, duration, isPlaying }) {
  if (!state.transcript || state.transcript.length === 0) return;

  elements.activeTimeDisplay.textContent = `${TranscriberService.formatTime(currentTime)} / ${TranscriberService.formatTime(duration)}`;

  if (state.readingMode) return;

  // Find corresponding transcript index
  let foundIndex = -1;
  for (let i = 0; i < state.transcript.length; i++) {
    const cur = state.transcript[i];
    const next = state.transcript[i + 1];
    const endTime = next ? next.start : cur.start + (cur.duration || 3);

    if (currentTime >= cur.start && currentTime < endTime) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1 && currentTime < state.transcript[0].start) {
    foundIndex = 0;
  }

  if (foundIndex !== -1 && foundIndex !== state.activeIndex) {
    const oldRow = document.getElementById(`transcript-row-${state.activeIndex}`);
    if (oldRow) oldRow.classList.remove('active');

    state.activeIndex = foundIndex;

    const newRow = document.getElementById(`transcript-row-${foundIndex}`);
    if (newRow) {
      newRow.classList.add('active');

      if (state.autoScroll) {
        newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

function filterTranscriptDisplay() {
  const query = state.searchQuery;
  const rows = elements.transcriptList.querySelectorAll('.transcript-row');

  rows.forEach((row, idx) => {
    const item = state.transcript[idx];
    if (!item) return;

    const matches =
      item.text.toLowerCase().includes(query) ||
      (item.originalText && item.originalText.toLowerCase().includes(query));

    row.style.display = matches ? 'flex' : 'none';
  });
}

async function handleGenerateSummary() {
  if (!state.transcript || state.transcript.length === 0) {
    showToast('No transcript loaded to summarize', 'warning');
    return;
  }

  elements.summaryModal.classList.add('active');
  elements.summaryContent.innerHTML = `
    <div class="summary-loading">
      <div class="spinner-small"></div>
      <p>Generating AI key takeaways & summary...</p>
    </div>
  `;

  try {
    const summary = await SummaryService.generateSummary(
      state.transcript,
      state.videoInfo?.title,
      state.activeLanguage === 'auto' ? state.sourceLanguage : state.activeLanguage
    );

    let bulletsHtml = summary.keyTakeaways
      .map(k => `<li><strong>Key Point:</strong> ${escapeHtml(k)}</li>`)
      .join('');

    elements.summaryContent.innerHTML = `
      <div class="summary-meta-badges">
        <span class="badge">📖 ${summary.estimatedReadingTime}</span>
        <span class="badge">📊 ${summary.totalWords} words</span>
        <span class="badge">🌐 ${getLanguageByCode(state.activeLanguage).name}</span>
      </div>
      <div class="summary-block">
        <h4>⚡ Quick Overview</h4>
        <p>${escapeHtml(summary.overview)}</p>
      </div>
      <div class="summary-block">
        <h4>🎯 Key Highlights & Takeaways</h4>
        <ul class="summary-list">
          ${bulletsHtml}
        </ul>
      </div>
      <button class="btn btn-secondary copy-summary-btn" style="margin-top: 1rem;">📋 Copy Summary</button>
    `;

    elements.summaryContent.querySelector('.copy-summary-btn').addEventListener('click', async () => {
      const text = `SUMMARY: ${summary.title}\n\nOVERVIEW:\n${summary.overview}\n\nKEY TAKEAWAYS:\n${summary.keyTakeaways.join('\n- ')}`;
      await navigator.clipboard.writeText(text);
      showToast('Summary copied to clipboard!', 'success');
    });
  } catch (err) {
    elements.summaryContent.innerHTML = `
      <div class="alert alert-error">Failed to generate summary: ${err.message}</div>
    `;
  }
}

function speakText(text, langCode) {
  if (!('speechSynthesis' in window)) {
    showToast('Text-to-speech is not supported by your browser', 'warning');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langCode || 'en';
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function showToast(message, type = 'info') {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type}`;
  setTimeout(() => {
    elements.toast.className = 'toast';
  }, 3200);
}

function showStatusAlert(msg, type = 'info') {
  elements.statusAlert.textContent = msg;
  elements.statusAlert.className = `alert alert-${type}`;
  elements.statusAlert.style.display = 'block';
}

function hideStatusAlert() {
  elements.statusAlert.style.display = 'none';
}

function showLoading(isLoading, customText) {
  if (isLoading) {
    elements.loadingSpinner.style.display = 'flex';
    if (customText) {
      const textEl = elements.loadingSpinner.querySelector('.loading-text');
      if (textEl) textEl.textContent = customText;
    }
  } else {
    elements.loadingSpinner.style.display = 'none';
  }
}

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const videoParam = params.get('v') || params.get('url');
  if (videoParam) {
    elements.urlInput.value = videoParam;
    handleFetchVideo();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
