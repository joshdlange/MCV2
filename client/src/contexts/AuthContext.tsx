import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { auth, onAuthStateChanged, signOutUser } from '@/lib/firebase';
import { handleRedirect } from '@/lib/handleRedirect';
import { useAppStore } from '@/lib/store';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { registerPushNotifications } from '@/services/pushNotifications';
import {
  syncFirebaseUserWithBackend,
  type BackendUser,
} from '@/lib/backendUserSync';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  syncError: boolean;
  refreshUser: () => Promise<void>;
  retrySync: () => Promise<void>;
  signOutAfterSyncError: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  syncError: false,
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
  const [syncError, setSyncError] = useState(false);
  const { setCurrentUser } = useAppStore();

  const applyBackendUser = useCallback((backendUser: BackendUser) => {
    setCurrentUser({
      id: backendUser.id,
      name: backendUser.displayName || backendUser.username,
      email: backendUser.email,
      avatar: backendUser.photoURL || '',
      isAdmin: backendUser.isAdmin,
      plan: backendUser.plan,
      subscriptionStatus: backendUser.subscriptionStatus,
      onboardingComplete: backendUser.onboardingComplete || false,
      username: backendUser.username
    });
  }, [setCurrentUser]);

  // Network-only sync. Callers must re-check auth state before committing the
  // returned backend identity into React or the persisted app store.
  const syncUserWithBackend = useCallback(async (firebaseUser: User) => {
    const backendUser = await syncFirebaseUserWithBackend(firebaseUser);
    console.log('User synced with backend:', backendUser);
    return backendUser;
  }, []);

  const completeFirebaseSession = useCallback(async (
    firebaseUser: User,
    isCurrent: () => boolean = () => auth.currentUser?.uid === firebaseUser.uid,
  ) => {
    if (!isCurrent()) return false;
    setLoading(true);
    setSyncError(false);
    setUser(null);
    // Never show a persisted user from another or partially-created session.
    setCurrentUser(null);

    try {
      const backendUser = await syncUserWithBackend(firebaseUser);
      if (!isCurrent()) return false;
      applyBackendUser(backendUser);
      setUser(firebaseUser);
      setSyncError(false);
      void registerPushNotifications();
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      console.error('Backend account sync failed; blocking app access:', error);
      setUser(null);
      setCurrentUser(null);
      setSyncError(true);
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [applyBackendUser, setCurrentUser, syncUserWithBackend]);

  const refreshExistingSession = useCallback(async (firebaseUser: User) => {
    try {
      const backendUser = await syncUserWithBackend(firebaseUser);
      if (auth.currentUser?.uid !== firebaseUser.uid) return;
      applyBackendUser(backendUser);
      setUser(firebaseUser);
      setSyncError(false);
      void registerPushNotifications();
    } catch (error) {
      if (auth.currentUser?.uid !== firebaseUser.uid) return;
      console.error('Backend account refresh failed; blocking app access:', error);
      setUser(null);
      setCurrentUser(null);
      setSyncError(true);
    }
  }, [applyBackendUser, setCurrentUser, syncUserWithBackend]);

  // Function to refresh user data from backend
  const refreshUser = async () => {
    if (user) {
      const backendUser = await syncUserWithBackend(user);
      if (auth.currentUser?.uid === user.uid) {
        applyBackendUser(backendUser);
      }
    }
  };

  const retrySync = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      setSyncError(false);
      setUser(null);
      setCurrentUser(null);
      return;
    }
    await completeFirebaseSession(firebaseUser);
  };

  const signOutAfterSyncError = async () => {
    await signOutUser();
    setUser(null);
    setCurrentUser(null);
    setSyncError(false);
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
          setSyncError(false);
          setLoading(false);
        }
      });

      return () => {
        disposed = true;
        authStateGeneration += 1;
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