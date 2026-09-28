import axios from 'axios';

// 既定は同じURLの /api（next.config.js でバックエンドへ中継）。別ドメインのAPIを使う場合だけ環境変数で指定する
const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL || '/api' });
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ログインが必要な画面でログイン切れ（401）になったら、ログイン画面に戻す。
// （ログイン画面そのものの「パスワード違い」は画面側でエラー表示するため対象外）
api.interceptors.response.use(undefined, (error) => {
  if (typeof window !== 'undefined' && error?.response?.status === 401 && window.location.pathname !== '/login') {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  return Promise.reject(error);
});

export default api;
