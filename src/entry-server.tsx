// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en-GB">
        <head>
          <meta charset="utf-8" />
          {/* viewport-fit=cover so the bottom sheet can sit under the home
              indicator, and safe-area insets can be spent rather than wasted. */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5"
          />
          <meta name="theme-color" content="#faf8f5" media="(prefers-color-scheme: light)" />
          <meta name="theme-color" content="#14151a" media="(prefers-color-scheme: dark)" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          {/* Two connections the map genuinely needs, and nothing else. There is
              no analytics, no tag manager and no font CDN on this site. */}
          <link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin="" />
          <link rel="dns-prefetch" href="https://tiles.openfreemap.org" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));