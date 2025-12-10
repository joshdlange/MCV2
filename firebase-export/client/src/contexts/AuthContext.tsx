import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { auth, onAuthStateChanged } from '@/lib/firebase';
import { handleRedirect } from '@/lib/handleRedirect';
import { useAppStore } from '@/lib/store';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refreshUser: async () => {},
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
  const { setCurrentUser } = useAppStore();

  // Function to sync user with backend and update app store
  const syncUserWithBackend = async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          firebaseUid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('User synced with backend:', data.user);
        
        // Update app store with backend user data (including admin status)
        setCurrentUser({
          id: data.user.id,
          name: data.user.displayName || data.user.username,
          email: data.user.email,
          avatar: data.user.photoURL || '',
          isAdmin: data.user.isAdmin,
          plan: data.user.plan,
          subscriptionStatus: data.user.subscriptionStatus,
          onboardingComplete: data.user.onboardingComplete || false,
          username: data.user.username
        });
      } else {
        console.error('Failed to sync user with backend');
      }
    } catch (error) {
      console.error('Error syncing user:', error);
    }
  };

  // Function to refresh user data from backend
  const refreshUser = async () => {
    if (user) {
      await syncUserWithBackend(user);
    }
  };

  useEffect(() => {
    try {
      // Handle redirect result from Google authentication
      handleRedirect();

      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        setUser(firebaseUser);
        
        if (firebaseUser) {
          // Always sync user data with backend to ensure admin status is current
          await syncUserWithBackend(firebaseUser);
        } else {
          // Clear user data when logged out
          setCurrentUser(null);
        }
        
        setLoading(false);
      });

      return unsubscribe;
    } catch (error) {
      console.error('Firebase auth error:', error);
      // If Firebase auth fails, still mark as not loading
      setLoading(false);
    }
  }, [setCurrentUser]);

  const value = {
    user,
    loading,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};