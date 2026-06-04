import type {
  WorkDetail,
  Episode,
  Program,
  CastEntry,
  StaffEntry,
  Season,
  WorkStatus,
  Media,
} from "@/lib/types";

/**
 * 開発・デモ用のサンプルデータ。
 * 外部APIやSupabaseが未設定でもアプリ全体を動かせるようにするためのもの。
 * 本番では Annict + しょぼいカレンダー の取り込み（lib/sync/ingest）で works テーブルが埋まる。
 *
 * 基準日: 2026-06-05（= 2026年 春クール）。
 */

interface WorkSpec {
  id: string;
  title: string;
  titleKana: string;
  titleEn?: string;
  synopsis: string;
  officialSiteUrl?: string;
  seasonYear: number;
  seasonName: Season;
  status: WorkStatus;
  media: Media;
  genres: string[];
  channel: { name: string; chid: number };
  /** 第1話の放送日時(ISO, +09:00) */
  firstAir: string;
  /** 30分枠なら30 */
  durationMin: number;
  episodeCount: number;
  /** サブタイトル一覧（null許容。配列長 < episodeCount のぶんは null） */
  subtitles: (string | null)[];
  subtitleSource: ("annict" | "syoboi")[];
  casts: [character: string, person: string][];
  staff: [role: string, person: string][];
}

const SPECS: WorkSpec[] = [
  {
    id: "frieren",
    title: "葬送のフリーレン",
    titleKana: "そうそうのふりーれん",
    titleEn: "Frieren: Beyond Journey's End",
    synopsis:
      "魔王を倒した勇者一行。その後を生きる長命なエルフの魔法使いフリーレンが、かつての仲間との旅を思い返しながら、人を知るための新たな旅へ出る。時間の流れと記憶をめぐる静かな物語。",
    officialSiteUrl: "https://frieren-anime.jp/",
    seasonYear: 2026,
    seasonName: "spring",
    status: "airing",
    media: "tv",
    genres: ["ファンタジー", "冒険", "ドラマ"],
    channel: { name: "日本テレビ系", chid: 1 },
    firstAir: "2026-04-03T23:00:00+09:00",
    durationMin: 30,
    episodeCount: 12,
    subtitles: [
      "旅の終わり",
      "別に魔法じゃなくても",
      "蒼月草",
      "魔法使いの里",
      null,
      "村の英雄",
      null,
    ],
    subtitleSource: ["annict", "annict", "syoboi", "annict", "annict", "syoboi", "annict"],
    casts: [
      ["フリーレン", "種﨑敦美"],
      ["フェルン", "市ノ瀬加那"],
      ["シュタルク", "小林千晃"],
      ["ヒンメル", "岡本信彦"],
      ["ハイター", "東地宏樹"],
      ["アイゼン", "上田燿司"],
    ],
    staff: [
      ["監督", "斎藤圭一郎"],
      ["シリーズ構成", "鈴木智尋"],
      ["キャラクターデザイン", "長澤礼子"],
      ["音楽", "Evan Call"],
      ["アニメーション制作", "MADHOUSE"],
    ],
  },
  {
    id: "kusuriya",
    title: "薬屋のひとりごと",
    titleKana: "くすりやのひとりごと",
    titleEn: "The Apothecary Diaries",
    synopsis:
      "花街で薬師として育った少女・猫猫が、後宮に下働きとして売られる。持ち前の薬学知識と観察眼で宮中の不可解な事件を次々と解き明かしていく、後宮ミステリー。",
    officialSiteUrl: "https://kusuriya-anime.jp/",
    seasonYear: 2026,
    seasonName: "spring",
    status: "airing",
    media: "tv",
    genres: ["ミステリー", "歴史", "ドラマ"],
    channel: { name: "日本テレビ系", chid: 1 },
    firstAir: "2026-04-05T22:00:00+09:00",
    durationMin: 30,
    episodeCount: 12,
    subtitles: ["猫猫", "麗しの妃", "毒見", null, "煤", null],
    subtitleSource: ["syoboi", "annict", "syoboi", "annict", "syoboi", "annict"],
    casts: [
      ["猫猫", "悠木碧"],
      ["壬氏", "大塚剛央"],
      ["玉葉妃", "種﨑敦美"],
      ["梨花妃", "甲斐田裕子"],
    ],
    staff: [
      ["監督", "長沼範裕"],
      ["シリーズ構成", "長月達平"],
      ["キャラクターデザイン", "中谷友紀子"],
      ["音楽", "神前暁"],
      ["アニメーション制作", "TOHO animation STUDIO / OLM"],
    ],
  },
  {
    id: "dan-da-dan",
    title: "ダンダダン",
    titleKana: "だんだだん",
    titleEn: "DAN DA DAN",
    synopsis:
      "幽霊を信じる少女と宇宙人を信じる少年。互いの存在を否定し合ううちに、本物のオカルトに巻き込まれていく。青春とオカルトが疾走するアクション。",
    officialSiteUrl: "https://anime-dandadan.com/",
    seasonYear: 2026,
    seasonName: "spring",
    status: "airing",
    media: "tv",
    genres: ["アクション", "オカルト", "青春"],
    channel: { name: "TOKYO MX", chid: 19 },
    firstAir: "2026-04-04T00:26:00+09:00",
    durationMin: 30,
    episodeCount: 12,
    subtitles: ["そうじゃなくて", null, "邪視じゃ", "ターボババアじゃ", null],
    subtitleSource: ["annict", "annict", "syoboi", "syoboi", "annict"],
    casts: [
      ["綾瀬桃", "若山詩音"],
      ["オカルン", "花江夏樹"],
      ["ターボババア", "田中真弓"],
    ],
    staff: [
      ["監督", "山代風我"],
      ["シリーズ構成", "瀬古浩司"],
      ["キャラクターデザイン", "鬼澤佳代"],
      ["音楽", "牛尾憲輔"],
      ["アニメーション制作", "サイエンスSARU"],
    ],
  },
  {
    id: "blue-orchestra",
    title: "蒼のオーケストラ",
    titleKana: "あおのおーけすとら",
    titleEn: "Blue Orchestra",
    synopsis:
      "かつて天才ヴァイオリン少年と呼ばれた青年が、高校のオーケストラ部で再び弦を握る。仲間との合奏を通して、音楽と向き合い直す青春群像。",
    seasonYear: 2026,
    seasonName: "spring",
    status: "airing",
    media: "tv",
    genres: ["音楽", "青春", "ドラマ"],
    channel: { name: "NHK Eテレ", chid: 4 },
    firstAir: "2026-04-06T17:00:00+09:00",
    durationMin: 30,
    episodeCount: 12,
    subtitles: ["はじまりの音", "調弦", null, "ソロ"],
    subtitleSource: ["annict", "syoboi", "annict", "syoboi"],
    casts: [
      ["青野一", "千葉翔也"],
      ["秋音律子", "加隈亜衣"],
    ],
    staff: [
      ["監督", "西片康人"],
      ["シリーズ構成", "吉田玲子"],
      ["キャラクターデザイン", "森田和明"],
      ["音楽", "出羽良彰"],
      ["アニメーション制作", "Nippon Animation"],
    ],
  },
  {
    id: "spy-cafe",
    title: "喫茶リコリス",
    titleKana: "きっさりこりす",
    synopsis:
      "表向きは小さな喫茶店、その実は街の揉め事を裏で解決する女子たちの拠点。日常とアクションが交差する、ゆるくて鋭いお仕事コメディ。",
    seasonYear: 2026,
    seasonName: "summer",
    status: "upcoming",
    media: "tv",
    genres: ["アクション", "日常", "コメディ"],
    channel: { name: "TOKYO MX", chid: 19 },
    firstAir: "2026-07-04T23:30:00+09:00",
    durationMin: 30,
    episodeCount: 12,
    subtitles: [null],
    subtitleSource: [],
    casts: [
      ["千束", "安済知佳"],
      ["たきな", "若山詩音"],
    ],
    staff: [
      ["監督", "足立慎吾"],
      ["シリーズ構成", "足立慎吾"],
      ["キャラクターデザイン", "いみぎむる"],
      ["アニメーション制作", "A-1 Pictures"],
    ],
  },
  {
    id: "summer-ghost",
    title: "夏の終わりと幽霊",
    titleKana: "なつのおわりとゆうれい",
    synopsis:
      "夏の終わり、ある噂を頼りに集まった三人の高校生が、線香花火で“幽霊”を呼び出す。ひと夏の出会いと別れを描く叙情的なドラマ。",
    seasonYear: 2026,
    seasonName: "summer",
    status: "upcoming",
    media: "tv",
    genres: ["ドラマ", "ファンタジー"],
    channel: { name: "テレビ朝日系", chid: 7 },
    firstAir: "2026-07-11T01:00:00+09:00",
    durationMin: 30,
    episodeCount: 10,
    subtitles: [],
    subtitleSource: [],
    casts: [
      ["佐藤涼", "島﨑信長"],
      ["絢子", "川栄李奈"],
    ],
    staff: [
      ["監督", "ロロ"],
      ["脚本", "ロロ"],
      ["アニメーション制作", "FLAT STUDIO"],
    ],
  },
  {
    id: "mecha-garden",
    title: "鉄花の庭",
    titleKana: "てっかのにわ",
    synopsis:
      "荒廃した大地に咲く“鉄花”を巡り、少年と旧式の機械人形が旅をする。失われた技術と記憶をたどるポストアポカリプス・ロードムービー。",
    seasonYear: 2026,
    seasonName: "summer",
    status: "upcoming",
    media: "tv",
    genres: ["SF", "ロボット", "冒険"],
    channel: { name: "TOKYO MX", chid: 19 },
    firstAir: "2026-07-06T22:00:00+09:00",
    durationMin: 30,
    episodeCount: 13,
    subtitles: [],
    subtitleSource: [],
    casts: [
      ["ハル", "村瀬歩"],
      ["No.07", "沢城みゆき"],
    ],
    staff: [
      ["監督", "立川譲"],
      ["シリーズ構成", "大河内一楼"],
      ["キャラクターデザイン", "田中将賀"],
      ["音楽", "澤野弘之"],
      ["アニメーション制作", "WIT STUDIO"],
    ],
  },
  {
    id: "winter-tale",
    title: "白銀の灯火",
    titleKana: "はくぎんのともしび",
    synopsis:
      "雪に閉ざされた山間の村で、灯台守の少女が冬を越す。静謐な暮らしと小さな奇跡を一話ごとに描く連作短編。",
    seasonYear: 2026,
    seasonName: "winter",
    status: "finished",
    media: "tv",
    genres: ["日常", "ドラマ"],
    channel: { name: "BS11", chid: 21 },
    firstAir: "2026-01-09T23:30:00+09:00",
    durationMin: 30,
    episodeCount: 12,
    subtitles: ["初雪", "灯をともす", "凍る湖", "雪解け前", "春を待つ"],
    subtitleSource: ["annict", "annict", "annict", "syoboi", "annict"],
    casts: [
      ["ユキ", "高橋李依"],
      ["祖母", "竹下景子"],
    ],
    staff: [
      ["監督", "山田尚子"],
      ["シリーズ構成", "吉田玲子"],
      ["音楽", "牛尾憲輔"],
      ["アニメーション制作", "京都アニメーション"],
    ],
  },
  {
    id: "battle-chef",
    title: "バトルシェフ・グランプリ",
    titleKana: "ばとるしぇふぐらんぷり",
    synopsis:
      "料理が国の力を左右する世界。地方出身の少年シェフが、頂点を決める料理大会“グランプリ”に挑む。熱血グルメバトル。",
    seasonYear: 2026,
    seasonName: "spring",
    status: "airing",
    media: "tv",
    genres: ["グルメ", "バトル", "コメディ"],
    channel: { name: "テレビ東京系", chid: 9 },
    firstAir: "2026-04-02T18:25:00+09:00",
    durationMin: 30,
    episodeCount: 24,
    subtitles: ["はじめての厨房", null, "対決、火の魔術師", "隠し味"],
    subtitleSource: ["annict", "annict", "syoboi", "syoboi"],
    casts: [
      ["リオ", "村瀬歩"],
      ["師匠", "津田健次郎"],
    ],
    staff: [
      ["監督", "神谷純"],
      ["シリーズ構成", "横手美智子"],
      ["アニメーション制作", "ぴえろ"],
    ],
  },
];

function buildWork(spec: WorkSpec): WorkDetail {
  const episodes: Episode[] = [];
  const programs: Program[] = [];
  const first = new Date(spec.firstAir);

  for (let i = 0; i < spec.episodeCount; i++) {
    const num = i + 1;
    const epId = `${spec.id}-ep${num}`;
    const subtitle = spec.subtitles[i] ?? null;
    const source = subtitle ? spec.subtitleSource[i] ?? "annict" : null;
    episodes.push({
      id: epId,
      workId: spec.id,
      number: num,
      numberText: `第${num}話`,
      title: subtitle,
      titleSource: source,
      sort: num,
    });

    const start = new Date(first.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + spec.durationMin * 60 * 1000);
    programs.push({
      id: `${spec.id}-prog${num}`,
      workId: spec.id,
      episodeId: epId,
      channelId: `ch-${spec.channel.chid}`,
      channelName: spec.channel.name,
      count: num,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      isRebroadcast: false,
      syoboiPid: spec.channel.chid * 100000 + Number(hashId(spec.id)) % 1000 * 100 + num,
    });
  }

  const casts: CastEntry[] = spec.casts.map(([characterName, personName], idx) => ({
    id: `${spec.id}-cast${idx}`,
    characterName,
    personName,
    personId: null,
    sort: idx,
  }));

  const staff: StaffEntry[] = spec.staff.map(([role, personName], idx) => ({
    id: `${spec.id}-staff${idx}`,
    role,
    personName,
    personId: null,
    sort: idx,
  }));

  return {
    id: spec.id,
    title: spec.title,
    titleKana: spec.titleKana,
    titleEn: spec.titleEn ?? null,
    keyVisualUrl: null, // タイポグラフィ表紙をUI側で描画
    seasonYear: spec.seasonYear,
    seasonName: spec.seasonName,
    status: spec.status,
    media: spec.media,
    genres: spec.genres,
    synopsis: spec.synopsis,
    officialSiteUrl: spec.officialSiteUrl ?? null,
    episodes,
    casts,
    staff,
    programs,
  };
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 997;
}

export const SEED_WORKS: WorkDetail[] = SPECS.map(buildWork);
