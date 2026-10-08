import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the phone bottom nav; errors still show without it.
  devIndicators: false,
  // Lets your phone open the dev server over home/college Wi-Fi (http://<mac-ip>:3000).
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
};

export default nextConfig;
