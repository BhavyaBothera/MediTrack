const API_BASE = '/api';

class ApiClient {
  getToken() {
    return localStorage.getItem('meditrack_token') || '';
  }

  setSession(token, user) {
    localStorage.setItem('meditrack_token', token);
    localStorage.setItem('meditrack_user', JSON.stringify(user));
  }

  clearSession() {
    localStorage.removeItem('meditrack_token');
    localStorage.removeItem('meditrack_user');
    localStorage.removeItem('meditrack_active_patient');
  }

  getActivePatientId() {
    const user = this.getUser();
    if (user?.role === 'caretaker') {
      return localStorage.getItem('meditrack_active_patient') || '';
    }
    return user?.id || '';
  }

  setActivePatientId(patientId) {
    localStorage.setItem('meditrack_active_patient', patientId);
  }

  getUser() {
    try {
      const u = localStorage.getItem('meditrack_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  }

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      ...options,
      headers,
    };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, config);

      if (res.status === 401) {
        if (!endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/register')) {
          this.clearSession();
          window.location.hash = '#login';
          throw new Error('Session expired. Please log in again.');
        }
      }

      // Check if binary download (e.g. PDF or CSV)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/csv') || contentType.includes('application/pdf')) {
        return res.blob();
      }

      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Request failed');
      }

      return json;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err.message);
      throw err;
    }
  }

  get(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = query ? `${endpoint}?${query}` : endpoint;
    return this.request(url, { method: 'GET' });
  }

  post(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  upload(endpoint, formData) {
    return this.request(endpoint, {
      method: 'POST',
      body: formData,
    });
  }
}

export const api = new ApiClient();

