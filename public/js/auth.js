/**
 * User Authentication & Session Client Service
 * Manages user accounts, secure session tokens, and saved transcripts
 */
import { AppConfig } from './config.js';

const TOKEN_KEY = 'transcribex_auth_token';
const USER_KEY = 'transcribex_auth_user';

class AuthService {
  constructor() {
    this.token = null;
    this.user = null;
    this.listeners = [];
    this.initFromStorage();
  }

  initFromStorage() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
      const cached = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
      this.user = cached ? JSON.parse(cached) : null;
    } catch (_) {
      this.token = null;
      this.user = null;
    }
  }

  onAuthStateChanged(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
      // Immediately notify current state
      callback(this.user, this.isLoggedIn());
    }
  }

  notifyListeners() {
    for (const cb of this.listeners) {
      try {
        cb(this.user, this.isLoggedIn());
      } catch (e) {
        console.error('[Auth Listener Error]:', e);
      }
    }
  }

  isLoggedIn() {
    return Boolean(this.token && this.user);
  }

  getUser() {
    return this.user;
  }

  getToken() {
    return this.token;
  }

  getUserInitials() {
    if (!this.user || !this.user.name) return 'U';
    const parts = this.user.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return this.user.name.slice(0, 2).toUpperCase();
  }

  getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async checkCurrentSession() {
    if (!this.token) return null;
    try {
      const res = await fetch(AppConfig.apiUrl('/api/auth/me'), {
        headers: this.getAuthHeaders(),
      });
      if (!res.ok) {
        // Session expired or invalid on server
        this.clearSession();
        return null;
      }
      const data = await res.json();
      if (data && data.user) {
        this.user = data.user;
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(this.user));
        } catch (_) {}
        this.notifyListeners();
        return this.user;
      }
    } catch (err) {
      console.warn('[Auth] Session check failed, continuing with cached session:', err);
      return this.user;
    }
  }

  async register(name, email, password) {
    const res = await fetch(AppConfig.apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create account. Please try again.');
    }

    this.saveSession(data.token, data.user, true);
    return data;
  }

  async login(email, password, remember = true) {
    const res = await fetch(AppConfig.apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Invalid email or password.');
    }

    this.saveSession(data.token, data.user, remember);
    return data;
  }

  async logout() {
    try {
      if (this.token) {
        await fetch(AppConfig.apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: this.getAuthHeaders(),
        }).catch(() => {});
      }
    } finally {
      this.clearSession();
    }
  }

  saveSession(token, user, remember = true) {
    this.token = token;
    this.user = user;
    try {
      if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      }
    } catch (_) {}
    this.notifyListeners();
  }

  clearSession() {
    this.token = null;
    this.user = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch (_) {}
    this.notifyListeners();
  }

  async updateProfile(updates) {
    if (!this.isLoggedIn()) throw new Error('You must be signed in.');
    const res = await fetch(AppConfig.apiUrl('/api/auth/update-profile'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update profile.');
    }
    this.user = data.user;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
    } catch (_) {}
    this.notifyListeners();
    return data.user;
  }

  async getSavedTranscripts() {
    if (!this.isLoggedIn()) return [];
    const res = await fetch(AppConfig.apiUrl('/api/auth/saved-transcripts'), {
      headers: this.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load saved transcripts.');
    }
    return data.savedTranscripts || [];
  }

  async saveTranscript(payload) {
    if (!this.isLoggedIn()) throw new Error('Please sign in or register to save transcripts.');
    const res = await fetch(AppConfig.apiUrl('/api/auth/save-transcript'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save transcript.');
    }
    if (this.user) {
      this.user.savedTranscripts = data.savedTranscripts;
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      } catch (_) {}
      this.notifyListeners();
    }
    return data;
  }

  async deleteSavedTranscript(videoId) {
    if (!this.isLoggedIn()) throw new Error('You must be signed in.');
    const res = await fetch(AppConfig.apiUrl(`/api/auth/saved-transcripts/${encodeURIComponent(videoId)}`), {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete saved transcript.');
    }
    if (this.user) {
      this.user.savedTranscripts = data.savedTranscripts;
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      } catch (_) {}
      this.notifyListeners();
    }
    return data;
  }
}

export const auth = new AuthService();

