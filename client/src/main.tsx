import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Isolated development studio; eliminated from the published build.
if (import.meta.env.DEV && window.location.pathname === '/__dev/vault') {
  import('./components/vault-launch/VaultPreview').then(({ default: VaultPreview }) => {
    createRoot(document.getElementById("root")!).render(<VaultPreview />);
  });
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
