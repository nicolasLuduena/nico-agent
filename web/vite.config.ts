import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type ProxyOptions } from "vite";

// serve answers only on its own host, and a write only from a page there:
// the app served here is one, a page on any other origin stays refused.
const target = "http://127.0.0.1:42069";
const serve: ProxyOptions = {
  target,
  changeOrigin: true,
  configure: (proxy) =>
    proxy.on("proxyReq", (out, req) => {
      if (req.headers.origin === `http://${req.headers.host}`) out.setHeader("origin", target);
    }),
};

// `npm run dev` serves the app with hot reload against a running `nico-agent serve`.
export default defineConfig({
  plugins: [svelte()],
  server: { proxy: { "/api": serve, "/bucket": serve } },
});
