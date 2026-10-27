import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { searchHandler } from "./server/search.js";
import { mediaHandler } from "./server/media.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "publisher-search",
      configureServer(server) {
        server.middlewares.use(searchHandler);
        server.middlewares.use(mediaHandler);
      },
      configurePreviewServer(server) {
        server.middlewares.use(searchHandler);
        server.middlewares.use(mediaHandler);
      },
    },
  ],
});
