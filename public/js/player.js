/**
 * YouTube IFrame Player Manager with Real-Time Playback Synchronization
 */

let player = null;
let isApiReady = false;
let timeUpdateInterval = null;
let currentVideoId = null;
let onTimeUpdateCallback = null;
let onStateChangeCallback = null;

// Initialize YouTube IFrame API
export function initYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      isApiReady = true;
      resolve();
      return;
    }

    // Set callback
    window.onYouTubeIframeAPIReady = () => {
      isApiReady = true;
      resolve();
    };

    // Load tag
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
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
    player.loadVideoById({
      videoId: videoId,
      startSeconds: options.startSeconds || 0,
    });
    return player;
  }

  return new Promise((resolve) => {
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
          startTimeTracker();
          if (options.onReady) options.onReady(event);
          resolve(player);
        },
        onStateChange: (event) => {
          handleStateChange(event);
          if (onStateChangeCallback) onStateChangeCallback(event);
        },
        onError: (event) => {
          console.warn('YouTube Player Error:', event.data);
          if (options.onError) options.onError(event);
        },
      },
    });
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
