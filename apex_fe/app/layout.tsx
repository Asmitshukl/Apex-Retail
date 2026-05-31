import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LiveDashboardProvider } from "./components/LiveDashboardProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Apex Store Intelligence",
  description: "Live CCTV analytics dashboard for offline retail stores",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f6f7f8] text-slate-950">
        <LiveDashboardProvider>{children}</LiveDashboardProvider>
      </body>
    </html>
  );
}
