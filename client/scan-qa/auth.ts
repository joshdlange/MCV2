// Isolated build alias only. Never imported by the application.
export const useAuth = () => ({ user: { getIdToken: async () => "isolated-QA-not-live-token" }, loading: false });