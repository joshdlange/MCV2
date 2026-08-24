import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { auth } from "./firebase";
import type { Auth } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { createApiHeaders } from "./authHeaders";

// web | ios | android — computed once; sent on every request so the server
// can track which platforms each user actually uses.
const APP_PLATFORM = (() => {
  try {
    return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
  } catch {
    return "web";
  }
})();

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  let token: string | undefined;

  try {
    const user = (auth as any)?.currentUser;
    if (user) {
      token = await user.getIdToken();
    }
  } catch (error) {
    console.error('Error getting auth headers:', error);
  }

  return createApiHeaders(token, APP_PLATFORM);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = await getAuthHeaders();
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers = await getAuthHeaders();
    
    const res = await fetch(queryKey[0] as string, {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
