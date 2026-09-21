import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { auth, onAuthStateChanged, signOutUser } from '@/lib/firebase';
import { handleRedirect } from '@/lib/handleRedirect';
import { useAppStore } from '@/lib/store';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { getNativeLaunchSession } from '@/lib/nativeLaunchSession';
import {
  isRetryableSyncError,
  syncFirebaseUserWithBackend,
  type BackendUser,
} from '@/lib/backendUserSync';

export type AuthSyncError = 'temporary' | 'permanent' | null;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  syncError: AuthSyncError;
  refreshUser: () => Promise<void>;
  retrySync: () => Promise<void>;
  signOutAfterSyncError: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  syncError: null,
  refreshUser: async () => {},
  retrySync: async () => {},
  signOutAfterSyncError: async () => {},
});

export const useAuth = () => {
  return useContext(AuthContext);
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<AuthSyncError>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const { setCurrentUser } = useAppStore();

  const applyBackendUser = useCallback((backendUser: BackendUser) => {
    setCurrentUser({
      id: backendUser.id,
      name: backendUser.displayName || backendUser.username,
      email: backendUser.email,
      avatar: backendUser.photoURL || '',
      isAdmin: backendUser.isAdmin,
      imageAdmin: backendUser.imageAdmin || false,
      plan: backendUser.plan,
      subscriptionStatus: backendUser.subscriptionStatus,
      onboardingComplete: backendUser.onboardingComplete || false,
      totalLogins: backendUser.totalLogins || 0,
      username: backendUser.username
    });
    const selectedPlan = localStorage.getItem('selectedPlan');
    if (selectedPlan === 'SUPER_HERO' && backendUser.plan === 'SIDE_KICK') {
      localStorage.removeItem('selectedPlan');
      sessionStorage.setItem('showUpgradeOnLoad', 'true');
      setTimeout(() => {
        window.location.href = '/profile';
      }, 500);
    } else if (selectedPlan) {
      localStorage.removeItem('selectedPlan');
    }
  }, [setCurrentUser]);

  // Network-only sync. Callers must re-check auth state before committing the
  // returned backend identity into React or the persisted app store.
  const syncUserWithBackend = useCallback(async (
    firebaseUser: User,
    nativeLogin?: { sessionId: string; platform: "android" | "ios" },
    options?: { signal?: AbortSignal; onRetry?: () => void },
  ) => {
    const backendUser = await syncFirebaseUserWithBackend(firebaseUser, {
      nativeLogin,
      signal: options?.signal,
      onRetry: options?.onRetry,
    });
    return backendUser;
  }, []);

  const completeFirebaseSession = useCallback(async (
    firebaseUser: User,
    isCurrent: () => boolean = () => auth.currentUser?.uid === firebaseUser.uid,
  ) => {
    if (!isCurrent()) return false;
    syncAbortRef.current?.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setLoading(true);
    setSyncError(null);
    setUser(null);
    // Never show a persisted user from another or partially-created session.
    setCurrentUser(null);

    try {
      const backendUser = await syncUserWithBackend(
        firebaseUser,
        getNativeLaunchSession(),
        {
          signal: controller.signal,
          onRetry: () => {
            if (!isCurrent() || controller.signal.aborted) return;
            setSyncError('temporary');
            setLoading(false);
          },
        },
      );
      if (!isCurrent() || controller.signal.aborted) return false;
      applyBackendUser(backendUser);
      setUser(firebaseUser);
      setSyncError(null);
      return true;
    } catch (error) {
      if (!isCurrent() || controller.signal.aborted) return false;
      console.error('Backend account sync failed; blocking app access:', error);
      setUser(null);
      setCurrentUser(null);
      setSyncError(isRetryableSyncError(error) ? 'temporary' : 'permanent');
      return false;
    } finally {
      if (syncAbortRef.current === controller) syncAbortRef.current = null;
      if (isCurrent() && !controller.signal.aborted) setLoading(false);
    }
  }, [applyBackendUser, setCurrentUser, syncUserWithBackend]);

  const refreshExistingSession = useCallback(async (firebaseUser: User) => {
    if (syncAbortRef.current) return;
    const controller = new AbortController();
    syncAbortRef.current = controller;
    try {
      const backendUser = await syncUserWithBackend(firebaseUser, undefined, {
        signal: controller.signal,
      });
      if (auth.currentUser?.uid !== firebaseUser.uid || controller.signal.aborted) return;
      applyBackendUser(backendUser);
      setUser(firebaseUser);
      setSyncError(null);
    } catch (error) {
      if (auth.currentUser?.uid !== firebaseUser.uid || controller.signal.aborted) return;
      if (isRetryableSyncError(error)) {
        console.error('Temporary backend account refresh failure:', error);
        return;
      }
      console.error('Backend account refresh failed; blocking app access:', error);
      setUser(null);
      setCurrentUser(null);
      setSyncError('permanent');
    } finally {
      if (syncAbortRef.current === controller) syncAbortRef.current = null;
    }
  }, [applyBackendUser, setCurrentUser, syncUserWithBackend]);

  // Function to refresh user data from backend
  const refreshUser = async () => {
    if (user) {
      await refreshExistingSession(user);
    }
  };

  const retrySync = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      setSyncError(null);
      setUser(null);
      setCurrentUser(null);
      return;
    }
    await completeFirebaseSession(firebaseUser);
  };

  const signOutAfterSyncError = async () => {
    syncAbortRef.current?.abort();
    syncAbortRef.current = null;
    await signOutUser();
    setUser(null);
    setCurrentUser(null);
    setSyncError(null);
    setLoading(false);
  };

  useEffect(() => {
    let disposed = false;
    let authStateGeneration = 0;
    let appStateListener: { remove: () => Promise<void> } | null = null;

    const removeAppStateListener = async () => {
      const listener = appStateListener;
      appStateListener = null;
      if (listener) {
        await listener.remove().catch(error => {
          console.error('Failed to remove native app-state listener:', error);
        });
      }
    };

    try {
      // Handle redirect result from Google authentication
      handleRedirect();

      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        const generation = ++authStateGeneration;
        syncAbortRef.current?.abort();
        syncAbortRef.current = null;
        await removeAppStateListener();
        if (disposed || generation !== authStateGeneration) return;

        if (firebaseUser) {
          const isCurrent = () =>
            !disposed &&
            generation === authStateGeneration &&
            auth.currentUser?.uid === firebaseUser.uid;
          const synced = await completeFirebaseSession(firebaseUser, isCurrent);
          if (disposed || generation !== authStateGeneration) return;

          if (synced && Capacitor.isNativePlatform()) {
            const listener = await App.addListener('appStateChange', ({ isActive }) => {
              if (isActive && auth.currentUser?.uid === firebaseUser.uid) {
                // Refresh in place on resume. The initial login remains gated,
                // but an already-valid session should not blank the app while
                // checking backend account/subscription state.
                void refreshExistingSession(firebaseUser);
              }
            });
            if (disposed || generation !== authStateGeneration) {
              await listener.remove();
            } else {
              appStateListener = listener;
            }
          }
        } else {
          setUser(null);
          setCurrentUser(null);
          setSyncError(null);
          setLoading(false);
        }
      });

      return () => {
        disposed = true;
        authStateGeneration += 1;
        syncAbortRef.current?.abort();
        syncAbortRef.current = null;
        unsubscribe();
        void removeAppStateListener();
      };
    } catch (error) {
      console.error('Firebase auth error:', error);
      // If Firebase auth fails, still mark as not loading
      setLoading(false);
    }
  }, [completeFirebaseSession, refreshExistingSession, setCurrentUser]);

  const value = {
    user,
    loading,
    syncError,
    refreshUser,
    retrySync,
    signOutAfterSyncError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};