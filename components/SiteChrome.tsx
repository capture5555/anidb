"use client";

import { usePathname } from "next/navigation";

/**
 * ログイン(/gate)など特定ページではヘッダー/フッターを出さず、本文だけを全画面で表示する。
 * header/footer はサーバーコンポーネントを children として受け取る（クライアント境界OK）。
 */
export function SiteChrome({
  header,
  footer,
  children,
}: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const bare = pathname === "/gate";

  if (bare) {
    return <main className="flex-1">{children}</main>;
  }
  return (
    <>
      {header}
      <main className="flex-1">{children}</main>
      {footer}
    </>
  );
}
