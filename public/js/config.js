/**
 * Global Configuration for Web & Mobile Native App (Capacitor)
 */
export const AppConfig = {
  // Default to relative path for web browser.
  // When running on Android APK, you can set your live Render URL here or in settings!
  DEFAULT_BACKEND_URL: '',

  /**
   * Get the active backend API base URL
   */
  getApiBaseUrl() {
    // 1. Check if user configured a backend URL in localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('CUSTOM_API_BACKEND_URL');
      if (saved && saved.trim()) {
        return saved.trim().replace(/\/$/, '');
      }

      // 2. Check if window environment variable was injected
      if (window.API_BACKEND_URL) {
        return window.API_BACKEND_URL.replace(/\/$/, '');
      }

      // 3. If running inside native Android / iOS Capacitor environment
      const isNative = window.location.protocol === 'capacitor:' || 
                       (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());

      if (isNative && this.DEFAULT_BACKEND_URL) {
        return this.DEFAULT_BACKEND_URL.replace(/\/$/, '');
      }
    }

    // Default: relative path for browser & local dev
    return '';
  },

  /**
   * Format full API endpoint URL
   */
  apiUrl(path) {
    const base = this.getApiBaseUrl();
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
};
