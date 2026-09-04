/**
 * YouTube IFrame Player Manager with Real-Time Playback Synchronization
 */

let player = null;
let isApiReady = false;
let timeUpdateInterval = null;
let currentVideoId = null;
let onTimeUpdateCallback = null;
let onStateChangeCallback = null;

// Initialize YouTube IFrame API with timeout and adblocker resiliency
export function initYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      isApiReady = true;
      resolve();
      return;
    }

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('YouTube Iframe API timed out (adblocker or slow connection). Proceeding.');
        resolve();
      }
    }, 2500);

    // Set callback
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (prevCallback) prevCallback();
      isApiReady = true;
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    // Load tag if not present
    if (!document.querySelector('script[src*="iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => {
        clearTimeout(timeout);
        console.warn('YouTube Iframe API script blocked or failed to load.');
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
    }
  });
}

/**
 * Load or update the YouTube player with a specific videoId
 */
export async function loadVideo(containerId, videoId, options = {}) {
  await initYouTubeAPI();

  currentVideoId = videoId;
  onTimeUpdateCallback = options.onTimeUpdate || null;
  onStateChangeCallback = options.onStateChange || null;

  if (player && player.loadVideoById) {
    try {
      player.loadVideoById({
        videoId: videoId,
        startSeconds: options.startSeconds || 0,
      });
      return player;
    } catch (e) {
      console.warn('loadVideoById failed, re-initializing player:', e);
    }
  }

  // If window.YT.Player is still unavailable (e.g. adblocker on laptop browser)
  if (!window.YT || !window.YT.Player) {
    console.warn('window.YT not available, embedding standard iframe fallback');
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<iframe 
        id="yt-fallback-iframe"
        src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&playsinline=1" 
        style="width:100%;height:100%;border:none;border-radius:inherit;" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
        allowfullscreen></iframe>`;
    }
    return null;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const readyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('YT.Player onReady timeout reached. Resolving.');
        resolve(player);
      }
    }, 3000);

    try {
      player = new window.YT.Player(containerId, {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            clearTimeout(readyTimeout);
            startTimeTracker();
            if (options.onReady) options.onReady(event);
            if (!resolved) {
              resolved = true;
              resolve(player);
            }
          },
          onStateChange: (event) => {
            handleStateChange(event);
            if (onStateChangeCallback) onStateChangeCallback(event);
          },
          onError: (event) => {
            clearTimeout(readyTimeout);
            console.warn('YouTube Player Error:', event.data);
            if (options.onError) options.onError(event);
            if (!resolved) {
              resolved = true;
              resolve(player);
            }
          },
        },
      });
    } catch (err) {
      clearTimeout(readyTimeout);
      console.warn('Error creating YT.Player:', err);
      resolve(null);
    }
  });
}

/**
 * Seek video player to exact second
 */
export function seekTo(seconds, allowPlay = true) {
  if (!player || !player.seekTo) return;
  player.seekTo(seconds, true);
  if (allowPlay && player.getPlayerState && player.getPlayerState() !== 1) {
    player.playVideo();
  }
}

/**
 * Play/Pause video
 */
export function togglePlayPause() {
  if (!player) return;
  const state = player.getPlayerState();
  if (state === 1) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

/**
 * Set playback rate (speed)
 */
export function setPlaybackRate(rate) {
  if (player && player.setPlaybackRate) {
    player.setPlaybackRate(rate);
  }
}

/**
 * Get current time in seconds
 */
export function getCurrentTime() {
  if (player && player.getCurrentTime) {
    return player.getCurrentTime();
  }
  return 0;
}

/**
 * Get video duration
 */
export function getDuration() {
  if (player && player.getDuration) {
    return player.getDuration();
  }
  return 0;
}

/**
 * Track playback time smoothly
 */
function startTimeTracker() {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval);

  timeUpdateInterval = setInterval(() => {
    if (!player || !player.getCurrentTime) return;
    const currentTime = player.getCurrentTime();
    const duration = player.getDuration ? player.getDuration() : 0;
    const state = player.getPlayerState ? player.getPlayerState() : -1;

    if (onTimeUpdateCallback && (state === 1 || state === 2 || state === 3)) {
      onTimeUpdateCallback({
        currentTime,
        duration,
        isPlaying: state === 1,
      });
    }
  }, 150);
}

function handleStateChange(event) {
  // 1 = playing, 2 = paused, 0 = ended, 3 = buffering
  if (event.data === 1) {
    startTimeTracker();
  }
}

export function destroyPlayer() {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval);
  if (player && player.destroy) {
    player.destroy();
    player = null;
  }
}
