import { createRoot } from "react-dom/client";
import App from "./App";
import { NativeVaultLaunch } from "./components/vault-launch/NativeVaultLaunch";
import "./index.css";

// Isolated development studio; eliminated from the published build.
if (import.meta.env.DEV && window.location.pathname === '/__dev/vault') {
  import('./components/vault-launch/VaultPreview').then(({ default: VaultPreview }) => {
    createRoot(document.getElementById("root")!).render(<VaultPreview />);
  });
} else {
  // Stable root sibling: auth providers, route switches and redirects cannot
  // unmount the launch sequence before its black-to-app handoff completes.
  createRoot(document.getElementById("root")!).render(<><NativeVaultLaunch /><App /></>);
}
