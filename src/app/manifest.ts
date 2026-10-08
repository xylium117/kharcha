import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kharcha – pocket money tracker",
    short_name: "Kharcha",
    description: "Track daily spending, stay on budget and ask Kharcha the owl before you buy.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffbf5",
    theme_color: "#c8b6ff",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
