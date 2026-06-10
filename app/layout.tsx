import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const gothic = Noto_Sans_JP({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-gothic",
});

export const metadata: Metadata = {
  title: {
    default: "アニメ放送カレンダー｜放送中・放送予定のアニメ情報",
    template: "%s｜アニメ放送カレンダー",
  },
  description:
    "今期・来期・放送中・放送予定のアニメ情報をまとめて閲覧。気になる作品はカレンダー購読でGoogleカレンダーへ自動反映できます。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={gothic.variable}>
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
