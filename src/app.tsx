import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { ErrorBoundary, Suspense } from "solid-js";
import SiteFooter from "~/components/SiteFooter";
import SiteHeader from "~/components/SiteHeader";
import "./global.css";
import "./map/map.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Pampered — places to take your dog</Title>
          <a class="skip-link" href="#results">
            Skip to the list
          </a>
          <SiteHeader />
          <ErrorBoundary
            fallback={(err, reset) => (
              <main class="page-fatal">
                <h1>Something went wrong</h1>
                <p class="muted">{err instanceof Error ? err.message : "Unknown error"}</p>
                <button type="button" class="btn" onClick={reset}>
                  Try again
                </button>
              </main>
            )}
          >
            <Suspense>{props.children}</Suspense>
          </ErrorBoundary>
          <SiteFooter />
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}