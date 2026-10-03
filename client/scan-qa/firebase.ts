// Isolated build alias only. No token is sent to a live API.
export const auth = { currentUser: { getIdToken: async () => "isolated-QA-not-live-token" } };