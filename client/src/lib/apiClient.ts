import { auth } from './firebase';
import { createApiHeaders } from './authHeaders';

// Enhanced API client that includes Firebase authentication headers
export const apiRequest = async (method: string, url: string, data?: any) => {
  const user = auth.currentUser;
  let token: string | undefined;

  if (user) {
    token = await user.getIdToken();
  }
  const headers = createApiHeaders(token);

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