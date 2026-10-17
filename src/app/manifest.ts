import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kharcha – pocket money tracker",
    short_name: "Kharcha",
    description: "Track daily spending, stay on budget and ask Stash the owl before you buy.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fffbf5",
    theme_color: "#c8b6ff",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Log ₹0 – No Spend Day",
        short_name: "No Spend",
        description: "Mark today as a zero-spend day",
        url: "/?action=zero-spend",
        icons: [{ src: "/pwa-icon/192", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Quick Add Expense",
        short_name: "Quick Add",
        description: "Log a quick expense with one tap",
        url: "/?action=quick-add",
        icons: [{ src: "/pwa-icon/192", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
