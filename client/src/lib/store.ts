import { create } from 'zustand';

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
  } | null;
  toggleAdminMode: () => void;
  toggleMobileMenu: () => void;
  setMobileMenuOpen: (open: boolean) => void;
  setCurrentUser: (user: AppState['currentUser']) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isAdminMode: false,
  isMobileMenuOpen: false,
  currentUser: null,
  toggleAdminMode: () => set((state) => ({ isAdminMode: !state.isAdminMode })),
  toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),
  setMobileMenuOpen: (open: boolean) => set({ isMobileMenuOpen: open }),
  setCurrentUser: (user) => set({ currentUser: user }),
}));
