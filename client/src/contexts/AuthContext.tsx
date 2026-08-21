import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { auth, onAuthStateChanged, signOutUser } from '@/lib/firebase';
import { handleRedirect } from '@/lib/handleRedirect';
import { useAppStore } from '@/lib/store';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { registerPushNotifications } from '@/services/pushNotifications';
import { syncFirebaseUserWithBackend } from '@/lib/backendUserSync';

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

  // Function to sync user with backend and update app store
  const syncUserWithBackend = useCallback(async (firebaseUser: User) => {
    const backendUser = await syncFirebaseUserWithBackend(firebaseUser);
    console.log('User synced with backend:', backendUser);

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

  const completeFirebaseSession = useCallback(async (firebaseUser: User) => {
    setLoading(true);
    setSyncError(false);
    setUser(null);
    // Never show a persisted user from another or partially-created session.
    setCurrentUser(null);

    try {
      await syncUserWithBackend(firebaseUser);
      setUser(firebaseUser);
      setSyncError(false);
      void registerPushNotifications();
      return true;
    } catch (error) {
      console.error('Backend account sync failed; blocking app access:', error);
      setUser(null);
      setCurrentUser(null);
      setSyncError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [setCurrentUser, syncUserWithBackend]);

  // Function to refresh user data from backend
  const refreshUser = async () => {
    if (user) {
      await syncUserWithBackend(user);
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
    try {
      // Handle redirect result from Google authentication
      handleRedirect();

      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          const synced = await completeFirebaseSession(firebaseUser);

          if (synced && Capacitor.isNativePlatform()) {
            App.addListener('appStateChange', ({ isActive }) => {
              if (isActive && firebaseUser) {
                void completeFirebaseSession(firebaseUser);
              }
            });
          }
        } else {
          setUser(null);
          setCurrentUser(null);
          setSyncError(false);
          setLoading(false);
        }
      });

      return unsubscribe;
    } catch (error) {
      console.error('Firebase auth error:', error);
      // If Firebase auth fails, still mark as not loading
      setLoading(false);
    }
  }, [completeFirebaseSession, setCurrentUser]);

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