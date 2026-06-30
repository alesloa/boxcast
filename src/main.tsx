import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ModalWindowHost } from "./windows/ModalWindowHost";
import { currentModalKind } from "./lib/modalWindow";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

// One bundle, two paths: a #<kind> hash means this document is a pop-out modal
// window, so render just that modal; otherwise render the full app.
const modalKind = currentModalKind();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {modalKind ? <ModalWindowHost kind={modalKind} /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
);
