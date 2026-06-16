import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteChrome } from "@/components/SiteChrome";

const gothic = Noto_Sans_JP({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-gothic",
});

export const metadata: Metadata = {
  title: {
    default: "アニメ作品データベース｜放送中・放送予定のアニメ情報と分析",
    template: "%s｜アニメ作品データベース",
  },
  description:
    "今期・来期・放送中・放送予定のアニメ情報と分析をまとめて閲覧。実況・Xバズ・継続率などの分析や、気になる作品のカレンダー購読にも対応。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={gothic.variable}>
      <body className="min-h-screen flex flex-col">
        <SiteChrome header={<SiteHeader />} footer={<SiteFooter />}>
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
