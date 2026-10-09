import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kharcha",
  description: "A pocket-money tracker for college students, with Stash the owl as your AI money guide",
  appleWebApp: { capable: true, title: "Kharcha", statusBarStyle: "default" },
  icons: { apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffbf5" },
    { media: "(prefers-color-scheme: dark)", color: "#15142a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const clientInitScript = `(function(){
  try{
    var p=localStorage.getItem('pp-theme')||'system';
    var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=d?'dark':'light';
  }catch(e){
    document.documentElement.dataset.theme='light';
  }
  document.addEventListener('contextmenu',function(e){e.preventDefault();},false);
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${grotesk.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: clientInitScript }} />
      </head>
      <body className="bg-blobs min-h-full">
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
