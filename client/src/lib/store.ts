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
  } | null;
  toggleAdminMode: () => void;
  toggleMobileMenu: () => void;
  setMobileMenuOpen: (open: boolean) => void;
  setCurrentUser: (user: AppState['currentUser']) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isAdminMode: false,
  isMobileMenuOpen: false,
  currentUser: {
    id: 1,
    name: "Stan Lee",
    email: "stan@marvel.com",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=32&h=32",
    isAdmin: true,
  },
  toggleAdminMode: () => set((state) => ({ isAdminMode: !state.isAdminMode })),
  toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),
  setMobileMenuOpen: (open: boolean) => set({ isMobileMenuOpen: open }),
  setCurrentUser: (user) => set({ currentUser: user }),
}));
