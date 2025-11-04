import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  isAdminMode: boolean;
  isMobileMenuOpen: boolean;
  currentUser: {
    id: number;
    name: string;
    email: string;
    avatar: string;
    isAdmin: boolean;
    plan: string;
    subscriptionStatus: string;
    onboardingComplete: boolean;
    username?: string;
  } | null;
  toggleAdminMode: () => void;
  toggleMobileMenu: () => void;
  setMobileMenuOpen: (open: boolean) => void;
  setCurrentUser: (user: AppState['currentUser']) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      isAdminMode: false,
      isMobileMenuOpen: false,
      currentUser: null,
      toggleAdminMode: () => {
        const { currentUser } = get();
        if (currentUser?.isAdmin) {
          set((state) => ({ isAdminMode: !state.isAdminMode }));
        }
      },
      toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),
      setMobileMenuOpen: (open: boolean) => set({ isMobileMenuOpen: open }),
      setCurrentUser: (user) => {
        set({ currentUser: user });
        // Auto-enable admin mode for admin users, but preserve their preference if already set
        if (user?.isAdmin) {
          const currentState = get();
          // Only auto-enable if user wasn't previously an admin (first login) or if admin mode was off
          if (!currentState.currentUser?.isAdmin || !currentState.isAdminMode) {
            set({ isAdminMode: true });
          }
        } else {
          // Disable admin mode for non-admin users
          set({ isAdminMode: false });
        }
      },
    }),
    {
      name: 'marvel-card-vault-store',
      partialize: (state) => ({ 
        isAdminMode: state.isAdminMode,
        currentUser: state.currentUser 
      }),
    }
  )
);
