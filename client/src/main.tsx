import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Provider } from "./components/ui/provider";
import "./index.css";
import { V2AppProvider } from "./v2/react/app-provider";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <Provider>
      <V2AppProvider>
        <App />
      </V2AppProvider>
    </Provider>
  </StrictMode>,
);
