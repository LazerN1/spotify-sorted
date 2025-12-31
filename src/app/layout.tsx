import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import BodyClass from "./body-class";
import TopNav from "./top-nav";

export const metadata: Metadata = {
  title: "Sorted",
  description: "A Spotify app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`antialiased`}
      >
        <Providers>
          <BodyClass />
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
