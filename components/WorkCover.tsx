import Image from "next/image";

/**
 * キービジュアル表示。
 * 画像URLがあれば画像を、無ければ作品ごとに色が決まる「活版風の表紙」を描画する。
 * （外部画像に依存せず、エディトリアルな見た目を保つための仕組み）
 */

// 紙物の世界観に合う、くすんだ色の組み合わせ
const PALETTES: { bg: string; ink: string }[] = [
  { bg: "#e7ddc8", ink: "#3a3022" },
  { bg: "#dfe2d6", ink: "#2f382c" },
  { bg: "#e6d6cf", ink: "#4a2f28" },
  { bg: "#d9ddE0", ink: "#283139" },
  { bg: "#ece2d0", ink: "#5a4a2c" },
  { bg: "#dde1dd", ink: "#33403a" },
  { bg: "#ecdcd8", ink: "#5a3330" },
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
    // 画像全体を見せつつ、上下の余白を同じ画像のぼかしで埋める（レターボックスのぼかし版）。
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
        {/* 背景: 同じ画像を拡大・ぼかして余白を埋める */}
        <Image
          src={url}
          alt=""
          aria-hidden
          fill
          className="object-cover scale-125 blur-xl opacity-60"
          sizes="(max-width:640px) 50vw, 240px"
        />
        {/* 前景: 画像全体を切らずに中央表示 */}
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
      className={`relative overflow-hidden flex flex-col justify-between p-3 ${className}`}
      style={{ backgroundColor: bg, color: ink }}
      aria-label={title}
    >
      <span
        className="text-[0.6rem] tracking-[0.2em] uppercase opacity-60"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {titleEn || "Anime"}
      </span>
      <span
        className="leading-tight"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 700,
          fontSize: title.length > 10 ? "1.05rem" : "1.35rem",
        }}
      >
        {title}
      </span>
      <span
        className="self-end text-[0.6rem] tracking-widest opacity-50"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        ◯
      </span>
    </div>
  );
}
