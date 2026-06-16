import Image from "next/image";

/**
 * キービジュアル表示。
 * 画像URLがあれば画像を、無ければ作品ごとに色が決まるプレースホルダー表紙を描画する。
 */

const PALETTES: { bg: string; ink: string }[] = [
  { bg: "#3b4a6b", ink: "#dce4f5" },
  { bg: "#4a3b5e", ink: "#e6dcf2" },
  { bg: "#2e4f4a", ink: "#d7ece8" },
  { bg: "#5e3b3b", ink: "#f2dede" },
  { bg: "#3b5e54", ink: "#dcf2ea" },
  { bg: "#54475e", ink: "#e8e0f0" },
  { bg: "#374f63", ink: "#dceaf5" },
];

function pick(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

export function WorkCover({
  id,
  title,
  titleEn,
  url,
  className = "",
}: {
  id: string;
  title: string;
  titleEn?: string | null;
  url?: string | null;
  className?: string;
}) {
  if (url) {
    // AniListの縦ポスターはそのまま敷き詰める。それ以外（Annictの横画像等）は
    // 画像全体を見せつつ、上下の余白を同じ画像のぼかしで埋める。
    const isPortraitPoster = url.includes("anilistcdn");
    if (isPortraitPoster) {
      return (
        <div className={`relative overflow-hidden bg-paper-deep ${className}`}>
          <Image src={url} alt={title} fill className="object-cover" sizes="(max-width:640px) 50vw, 240px" />
        </div>
      );
    }
    return (
      <div className={`relative overflow-hidden bg-paper-deep ${className}`}>
        <Image
          src={url}
          alt=""
          aria-hidden
          fill
          className="object-cover scale-125 blur-xl opacity-60"
          sizes="(max-width:640px) 50vw, 240px"
        />
        <Image
          src={url}
          alt={title}
          fill
          className="object-contain"
          sizes="(max-width:640px) 50vw, 240px"
        />
      </div>
    );
  }

  const { bg, ink } = pick(id);
  return (
    <div
      className={`relative overflow-hidden flex flex-col justify-center p-3 ${className}`}
      style={{ backgroundColor: bg, color: ink }}
      aria-label={title}
    >
      <span
        className="leading-snug font-bold"
        style={{ fontSize: title.length > 10 ? "0.95rem" : "1.2rem" }}
      >
        {title}
      </span>
      {titleEn && (
        <span className="mt-1 text-[0.58rem] tracking-wide opacity-60 truncate">{titleEn}</span>
      )}
    </div>
  );
}
