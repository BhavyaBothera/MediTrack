import { api } from './api.js';

export const auth = {
  isAuthenticated() {
    return Boolean(api.getToken() && api.getUser());
  },

  getUser() {
    return api.getUser();
  },

  async login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    if (res.session?.access_token) {
      api.setSession(res.session.access_token, res.user);
    }
    return res;
  },

  async register(data) {
    const res = await api.post('/auth/register', data);
    if (res.session?.access_token) {
      api.setSession(res.session.access_token, res.user);
    }
    return res;
  },

  logout() {
    api.clearSession();
    window.location.hash = '#login';
    window.location.reload();
  },
};

