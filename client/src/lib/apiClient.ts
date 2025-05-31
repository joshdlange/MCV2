import { auth } from './firebase';

// Enhanced API client that includes Firebase authentication headers
export const apiRequest = async (method: string, url: string, data?: any) => {
  const user = auth.currentUser;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-firebase-uid'] = user.uid;
    headers['x-user-email'] = user.email || '';
    headers['x-display-name'] = user.displayName || '';
    headers['x-photo-url'] = user.photoURL || '';
    headers['x-user-name'] = user.displayName || user.email?.split('@')[0] || 'User';
  }

  const config: RequestInit = {
    method,
    headers,
  };

  if (data && method !== 'GET') {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(url, config);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  return response.json();
};