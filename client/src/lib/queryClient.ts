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
    const contentType = res.headers.get("content-type") || "";
    let message = res.statusText || "Request failed";

    if (contentType.includes("application/json")) {
      try {
        const body = await res.json();
        if (typeof body?.message === "string" && body.message.trim()) {
          message = body.message.trim();
        }
      } catch {
        // Keep the concise status message when an upstream returns malformed JSON.
      }
    } else {
      const text = (await res.text()).trim();
      const isHtml = contentType.includes("text/html") || /<!doctype html|<html[\s>]/i.test(text);
      if (!isHtml && text) message = text.slice(0, 300);
    }

    if ([502, 503, 504].includes(res.status) && message === res.statusText) {
      message = "The service is temporarily unavailable. Please try again.";
    }
    throw new Error(`${res.status}: ${message}`);
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
