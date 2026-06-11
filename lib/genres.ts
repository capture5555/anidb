/**
 * AniList ジャンル名の日本語ラベル辞書。
 *
 * 保存値・フィルタクエリ値（?genre=...）は英語のまま維持し、
 * 画面表示のラベルだけこの辞書を通して日本語化する。
 */
export const GENRE_JA: Record<string, string> = {
  Action: "アクション",
  Adventure: "冒険",
  Comedy: "コメディ",
  Drama: "ドラマ",
  Ecchi: "エッチ",
  Fantasy: "ファンタジー",
  Horror: "ホラー",
  "Mahou Shoujo": "魔法少女",
  Mecha: "メカ/ロボット",
  Music: "音楽",
  Mystery: "ミステリー",
  Psychological: "心理",
  Romance: "恋愛",
  "Sci-Fi": "SF",
  "Slice of Life": "日常",
  Sports: "スポーツ",
  Supernatural: "超常/超自然",
  Thriller: "スリラー",
  Hentai: "成人向け",
  // 追加ジャンル
  "Award Winning": "受賞作",
  "Boys Love": "ボーイズラブ",
  "Girls Love": "ガールズラブ",
  Gourmet: "グルメ",
  Isekai: "異世界",
  Suspense: "サスペンス",
};

/**
 * ジャンル名を日本語ラベルに変換する。
 * 辞書にあれば日本語を返し、なければ元の文字列をそのまま返す（防御的）。
 */
export function genreJa(name: string): string {
  return GENRE_JA[name] ?? name;
}
