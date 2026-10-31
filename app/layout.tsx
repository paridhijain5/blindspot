import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BlindSpot — Field Survey",
  description:
    "Map the gaps, conflicts, and outdated details hiding across your research sources.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrumentSans.variable} ${jetBrainsMono.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <header className="site-header">
          <Link className="wordmark" href="/" aria-label="BlindSpot home">
            <span className="wordmark-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8.5" stroke="currentColor" />
                <circle cx="12" cy="12" r="2.5" fill="#D6361F" />
                <path d="M12 1v5M12 18v5M1 12h5m12 0h5" stroke="currentColor" />
              </svg>
            </span>
            BlindSpot
          </Link>
          <nav className="site-nav" aria-label="Main navigation">
            <Link href="/#survey">Analyze</Link>
            <Link href="/how-it-works">How it works</Link>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <p className="footer-note">BlindSpot / Field notes for better research</p>
          <p className="footer-claim">
            Potential signals. Always verify with the official source.
          </p>
        </footer>
      </body>
    </html>
  );
}
