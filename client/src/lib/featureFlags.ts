export const FEATURE_FLAGS = {
  MARKETPLACE_ENABLED: import.meta.env.VITE_FEATURE_MARKETPLACE_ENABLED === 'true',
} as const;
