export const revalidate = 3600;

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "指標ガイド・データソース | アニメ分析",
  description:
    "アニメ分析で使用している各指標の定義・算出方法・データ出典、および利用上の注意を業界実務者向けに解説します。",
};

/* ================================================================
   指標ガイド・データソース ページ
   - サーバーコンポーネント（DBアクセスなし）
   - revalidate = 3600（1時間 ISR）
   ================================================================ */

export default function AnalyticsGuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      {/* パンくず */}
      <div className="text-xs text-muted mb-6">
        <Link href="/analytics" className="hover:text-primary transition-colors">
          アニメ分析
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-ink-soft">指標ガイド</span>
      </div>

      {/* ページタイトル */}
      <h1 className="section-title text-2xl sm:text-3xl mb-2">指標ガイド・データソース</h1>
      <p className="text-sm text-muted mb-10 leading-relaxed">
        本ページでは、アニメ分析画面で使用している各種指標の定義・算出の考え方・データ出典・解釈の注意点を説明します。
        制作・広報・編成・人事など、業務での活用を想定してまとめています。
      </p>

      {/* ================================================================
          1. データソース一覧
          ================================================================ */}
      <section className="mb-12">
        <h2 className="section-title text-xl mb-6">1. データソース一覧</h2>
        <div className="space-y-4">

          {/* ニコニコ実況 */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[0.68rem] font-black text-accent uppercase tracking-wide">
                ニコニコ実況
              </span>
              <span className="text-[0.68rem] text-muted">過去ログ API</span>
            </div>
            <h3 className="font-black text-base text-ink mb-3">
              放送中のコメント（分単位の実況データ）
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-bold text-ink-soft">測っているもの</dt>
                <dd className="text-ink-soft leading-relaxed">
                  放送時間帯に視聴者がニコニコ実況チャンネルへ投稿したコメントの件数と内容。
                  分単位の時系列データを取得しているため、各話内のどの瞬間に視聴者が反応したかを把握できます。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">母数</dt>
                <dd className="text-ink-soft">
                  ニコニコ実況を利用して放送中にコメントしたユーザー。テレビの視聴者全体ではなく、
                  アクティブなコメント投稿者のみを反映します。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">注意点</dt>
                <dd className="text-ink-soft leading-relaxed">
                  テレビ視聴率・総視聴者数とは異なります。深夜アニメのコアユーザー層が中心で、
                  ファミリー向けや早朝帯のアニメは相対的に少なく見えることがあります。
                  コメント数はニコニコのサービス利用状況にも影響を受けます。
                </dd>
              </div>
            </dl>
          </div>

          {/* Annict */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[0.68rem] font-black text-accent uppercase tracking-wide">
                Annict
              </span>
              <span className="text-[0.68rem] text-muted">アニメ視聴記録サービス</span>
            </div>
            <h3 className="font-black text-base text-ink mb-3">
              記録数（ウォッチャー数）・満足度（良い率）
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-bold text-ink-soft">測っているもの</dt>
                <dd className="text-ink-soft leading-relaxed">
                  Annict ユーザーがその作品を「視聴中」「視聴済み」として記録した件数（認知・人気の代理指標）と、
                  話数ごとに付けられた「良い/普通/悪い」評価の割合（満足度の代理指標）。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">母数</dt>
                <dd className="text-ink-soft">
                  Annict の登録ユーザーのうち当該作品を記録したユーザー。
                  Annict のユーザー層は日本のアニメファン（比較的アクティブ層）が中心です。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">注意点</dt>
                <dd className="text-ink-soft leading-relaxed">
                  テレビ視聴率・総視聴者数とは異なります。
                  Annict に登録していないユーザーは含まれません。
                  満足度の「良い率」は評価を入力したユーザーのみを集計しており、
                  評価数が少ない場合はブレが大きくなります。
                </dd>
              </div>
            </dl>
          </div>

          {/* X (旧Twitter) */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[0.68rem] font-black text-accent uppercase tracking-wide">
                X（旧 Twitter）
              </span>
              <span className="text-[0.68rem] text-muted">Grok x_search による反応分析</span>
            </div>
            <h3 className="font-black text-base text-ink mb-3">
              Xバズ・センチメント・トレンドトピック
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-bold text-ink-soft">測っているもの</dt>
                <dd className="text-ink-soft leading-relaxed">
                  X（旧 Twitter）上での作品に関する投稿・反応の傾向。
                  Grok の x_search を通じて取得・分析しており、
                  話題量（volume）、センチメント（ポジティブ／賛否両論／ネガティブ）、
                  話題のキーワードを把握できます。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">母数</dt>
                <dd className="text-ink-soft">
                  X 上で当該作品について投稿した公開アカウント。
                  収集タイミングや検索クエリ設計によって抽出範囲が変動します。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">注意点</dt>
                <dd className="text-ink-soft leading-relaxed">
                  <strong className="text-ink">volume（0〜5 のバズ指数）は投稿量の体感的な推定値であり、
                  正確な投稿件数を示すものではありません。</strong>
                  X API の仕様変更・取得制限・収集タイミングによって
                  実際の話題量と乖離する場合があります。
                  センチメントは自動分類のため、皮肉・文脈依存の表現に誤判定が発生することがあります。
                </dd>
              </div>
            </dl>
          </div>

          {/* AniList / MyAnimeList */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[0.68rem] font-black text-accent uppercase tracking-wide">
                AniList・MyAnimeList
              </span>
              <span className="text-[0.68rem] text-muted">海外アニメデータベース</span>
            </div>
            <h3 className="font-black text-base text-ink mb-3">
              海外スコア・人気（グローバル評価）
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-bold text-ink-soft">測っているもの</dt>
                <dd className="text-ink-soft leading-relaxed">
                  AniList の平均スコア（100点満点）と人気ランキング、
                  MyAnimeList（MAL）の平均スコア（10点満点）を取得しています。
                  主に英語圏・グローバルのアニメファンの評価を反映します。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">母数</dt>
                <dd className="text-ink-soft">
                  AniList・MAL の各サービス登録ユーザーのうち、当該作品にスコアを付けたユーザー。
                  グローバルファン（英語圏を中心に欧米・東南アジア等を含む）が中心です。
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink-soft">注意点</dt>
                <dd className="text-ink-soft leading-relaxed">
                  国内の評価とは独立して動くことがあります（国内×海外乖離が大きい作品が存在します）。
                  スコアが付くまでにタイムラグがあり、放送直後は評価数が少なくブレが大きい傾向があります。
                </dd>
              </div>
            </dl>
          </div>

        </div>
      </section>

      {/* ================================================================
          2. 指標ガイド
          ================================================================ */}
      <section className="mb-12">
        <h2 className="section-title text-xl mb-6">2. 指標ガイド</h2>
        <div className="space-y-4">

          {/* 総合スコア */}
          <MetricCard
            id="overall-score"
            badge="総合スコア"
            title="総合スコア（0〜100 pts）"
            source="ニコニコ実況・Annict・X・AniList・MAL"
          >
            <MetricRow label="定義">
              認知（Annictウォッチャー数）・批評（AniList/MAL スコア）・実況エンゲージ（ニコニコ実況コメント総数）・
              Xバズ・継続/満足度の 5 シグナルを、同一クール内パーセンタイルで 0〜100 に正規化し加重平均した合成スコア。
            </MetricRow>
            <MetricRow label="算出の考え方">
              各シグナルをそのクールの全作品と比較した相対順位（パーセンタイル）に変換することで、
              「今期の中でどれだけ突出しているか」を単一スコアに集約します。
              欠測シグナルがある場合は残りシグナルの重みを自動再正規化して補います。
            </MetricRow>
            <MetricRow label="解釈の注意">
              クールが異なると比較対象が変わるため、シーズン間の単純比較には不向きです。
              全シグナルを取得できていない作品（配信のみ・深夜帯外等）は
              スコアが過小・過大に振れる場合があります。
            </MetricRow>
          </MetricCard>

          {/* 初速スコア */}
          <MetricCard
            id="fast-start"
            badge="初速スコア"
            title="初速スコア（第1話立ち上がり強度）"
            source="ニコニコ実況（第1話コメント数）・X（Grok x_search）"
          >
            <MetricRow label="定義">
              第1話放送直後の「実況初速」と「X初速」をクール内パーセンタイルでスコア化し、
              実況初速×0.6 ＋ X初速×0.4 で合成した指数（0〜100）。
              X データが未取得の場合は実況のみで再正規化します。
            </MetricRow>
            <MetricRow label="算出の考え方">
              「初動が強い作品は継続的な話題を呼びやすい」という前提に基づき、
              第1話時点の絶対値ではなく今期クール内の相対的な立ち上がりの強さを示します。
            </MetricRow>
            <MetricRow label="解釈の注意">
              原作ファンが多い続編・メジャー IP は初速が高くなりやすい傾向があります。
              純粋な新規 IP の発掘には補足的な定性評価も併用してください。
            </MetricRow>
          </MetricCard>

          {/* 認知×熱量 象限 */}
          <MetricCard
            id="quadrant"
            badge="認知×熱量"
            title="認知 × 熱量 象限マップ"
            source="X（Grok x_search: volume スコア）・Annict（ウォッチャー数）"
          >
            <MetricRow label="定義">
              横軸を「認知（Annict ウォッチャー数のクール内パーセンタイル）」、
              縦軸を「熱量（X バズ volume のクール内パーセンタイル）」として各作品を散布図に配置し、
              4象限（総合ヒット・PR先行・ファン型ダークホース・様子見）に分類します。
            </MetricRow>
            <MetricRow label="象限の意味">
              「総合ヒット」は認知・熱量ともに高い作品、「PR先行」は認知は高いが熱量はまだ低い作品、
              「ファン型ダークホース」は認知は低いが熱量は高いコアファン向け作品、
              「様子見」は両方が低い作品です。
            </MetricRow>
            <MetricRow label="解釈の注意">
              X の volume は推定値のため、認知と熱量の比率に数値的な精度は保証されません。
              作品の位置づけを俯瞰するための参考ツールとしてお使いください。
            </MetricRow>
          </MetricCard>

          {/* 視聴継続率 */}
          <MetricCard
            id="retention"
            badge="継続率"
            title="視聴継続率（残留率）"
            source="ニコニコ実況（デフォルト）・Annict 記録数（切替可）"
          >
            <MetricRow label="定義">
              第1話のコメント数（または記録数）を 100% としたとき、各話のコメント数（または記録数）が
              何%まで残っているかを表した曲線。
            </MetricRow>
            <MetricRow label="算出の考え方">
              「見始めた視聴者のうち何割が最新話まで追い続けているか」の代理指標として機能します。
              急激に落ち込む話はストーリー展開の変化点や視聴者離れのタイミングを示す可能性があります。
            </MetricRow>
            <MetricRow label="解釈の注意">
              テレビ視聴率ではありません。ニコニコ実況基準では、
              配信勢・録画勢は含まれないためコアな放送視聴者が対象になります。
              Annict 基準は評価入力ユーザーのみ。
              100%を超えることもあります（話題回でコメント数が第1話より多くなるケース）。
            </MetricRow>
          </MetricCard>

          {/* 満足度 */}
          <MetricCard
            id="satisfaction"
            badge="満足度"
            title="満足度（良い率）"
            source="Annict（話数ごとの評価）"
          >
            <MetricRow label="定義">
              Annict ユーザーが各話に付けた「良い/普通/悪い」評価のうち、「良い」が占める割合。
            </MetricRow>
            <MetricRow label="解釈の注意">
              評価を入力したユーザーのみを母数とするため、評価数が少ない場合はブレが大きくなります。
              話数が進むほど離脱した低評価ユーザーが評価しにくくなり、
              後半は過大評価になりやすい傾向があります（サバイバーバイアス）。
            </MetricRow>
          </MetricCard>

          {/* Xバズ */}
          <MetricCard
            id="xbuzz"
            badge="Xバズ"
            title="Xバズ（0〜5）とセンチメント"
            source="X（Grok x_search）"
          >
            <MetricRow label="定義">
              X 上での作品ごとの話題量を 0〜5 の段階値（volume）で表した推定指数。
              あわせて、投稿全体のトーンをポジティブ・賛否両論・ネガティブに分類したセンチメントを表示します。
            </MetricRow>
            <MetricRow label="重要な注意">
              <strong className="text-ink">volume は正確な投稿件数ではなく体感的な推定値です。</strong>
              Grok x_search による定性的な量感推定のため、
              「5 が 1 の5倍の投稿数」というような線形の解釈は適切ではありません。
              X API の取得制限・収集タイミングによって実際の話題量と乖離することがあります。
            </MetricRow>
            <MetricRow label="センチメントの注意">
              自動分類のため皮肉・ネタ投稿・文脈依存表現が誤判定されることがあります。
              ネガティブの比率が高くても「炎上系の話題」の場合は逆に認知が高まっているケースもあります。
            </MetricRow>
          </MetricCard>

          {/* 話数別3面比較 */}
          <MetricCard
            id="episode-triple"
            badge="3面比較"
            title="話数別 3面比較（実況・Xバズ・Annict記録）"
            source="ニコニコ実況・X（Grok x_search）・Annict"
          >
            <MetricRow label="定義">
              各回について「実況コメント数」「X バズ（volume）」「Annict 記録数の増分」を
              同一グラフ上に重ねて表示し、どの話数でどのシグナルが反応したかを視覚化します。
            </MetricRow>
            <MetricRow label="解釈の注意">
              3つのシグナルは母数・収集方法が異なるため、絶対値での比較は意味を持ちません。
              「その作品の中で相対的にどの話が盛り上がったか」を把握するための補助ツールとして使ってください。
            </MetricRow>
          </MetricCard>

          {/* 国内×海外乖離 */}
          <MetricCard
            id="global-gap"
            badge="国内×海外"
            title="国内 × 海外 乖離（グローバルギャップ）"
            source="Annict（国内代理）・AniList（海外代理）"
          >
            <MetricRow label="定義">
              AniList スコア（グローバル評価）と Annict 満足度（国内評価）の相対的な差を指標化し、
              海外で高評価・国内でも高評価・乖離が大きい作品を識別します。
            </MetricRow>
            <MetricRow label="解釈の注意">
              国内評価の代理として Annict を使用していますが、
              Annict も一部の積極的なアニメファン層を母数とするため「国内全般」を代表するものではありません。
              乖離が大きい作品は配信強化・海外展開の優先度判断の参考になりますが、
              単一指標で意思決定することは避けてください。
            </MetricRow>
          </MetricCard>

          {/* 続編可能性スコア */}
          <MetricCard
            id="sequel-prospect"
            badge="続編可能性"
            title="続編可能性スコア（参考値）"
            source="ニコニコ実況・Annict・X・AniList・MAL（BD売上等は含まない）"
          >
            <MetricRow label="定義">
              総合スコア・継続率・X バズ・海外評価など本サービスが取得できる指標を複合して算出した参考値。
            </MetricRow>
            <MetricRow label="重要な注意">
              <strong className="text-ink">BD（Blu-ray）売上・原作売上・配信再生数・製作委員会の意向など、
              続編決定に実際に影響する多くの重要因子はこのスコアに含まれていません。</strong>
              あくまで「ネット上の反応から見た関心度の高さ」の推定であり、
              続編可否の予測を保証するものではありません。
            </MetricRow>
          </MetricCard>

          {/* 急上昇アラート */}
          <MetricCard
            id="risers"
            badge="急上昇"
            title="急上昇アラート（直近話の伸び率）"
            source="ニコニコ実況"
          >
            <MetricRow label="定義">
              最新話の実況コメント数が「それ以前の話数の平均コメント数」を大幅に上回った作品。
              伸び率（%）でランキング表示します。
            </MetricRow>
            <MetricRow label="解釈の注意">
              話数が少ない場合は平均の安定性が低く、誤検知（見た目上の急上昇）が発生しやすくなります。
              特定回の炎上・異常なノイズコメントが混入している場合も急上昇と判定されることがあります。
              広報の朝チェックや PR 施策の効果確認の補助ツールとして活用してください。
            </MetricRow>
          </MetricCard>

          {/* 声優・スタッフ打率・偏差値・モメンタム */}
          <MetricCard
            id="people"
            badge="声優・スタッフ"
            title="声優・スタッフの打率・偏差値・モメンタム"
            source="ニコニコ実況・Annict・X・AniList・MAL（上記スコアの集計）"
          >
            <MetricRow label="定義">
              声優または監督・シリーズ構成等のスタッフが出演（担当）した作品の総合スコアを集計し、
              打率（スコア閾値超え作品数 ÷ 総出演作品数）・偏差値（出演作品スコアの相対評価）・
              モメンタム（直近作品の傾向）を表示します。
            </MetricRow>
            <MetricRow label="解釈の注意">
              作品のスコアは作品自体のクオリティや話題性を反映しており、
              個人の貢献度を直接評価するものではありません。
              人気 IP や原作の強さが高スコアに寄与するケースが多く、
              スタッフ・声優個人の実力の評価ツールとして単独で用いることは適切ではありません。
              出演作品数が少ない（目安: 3作品未満）場合は統計的に信頼性が低下します。
            </MetricRow>
          </MetricCard>

        </div>
      </section>

      {/* ================================================================
          免責事項
          ================================================================ */}
      <section className="card p-5 border-l-4 border-l-muted/40 mb-8">
        <h2 className="font-black text-base text-ink mb-3">免責事項・利用上の注意</h2>
        <div className="space-y-2 text-sm text-ink-soft leading-relaxed">
          <p>
            本サービスが提供するすべての指標・スコアは、公開されているデータを統計処理した
            <strong className="text-ink">参考値</strong>です。
            いずれも意思決定（キャスティング・制作続行・投資・広報戦略等）の唯一の根拠として
            使用することは想定していません。
          </p>
          <p>
            データは各 API・サービスの仕様変更・メンテナンス・取得タイミングによって
            最新の状態と乖離することがあります。
            スコアや順位の急変が起きた場合はデータ取得の問題である可能性もあります。
          </p>
          <p>
            各データソース（Annict・ニコニコ実況・X・AniList・MyAnimeList）は
            それぞれのサービスの利用者層・仕様・ポリシーのもとで提供されており、
            本サービスはそれらの代理指標として利用しているに過ぎません。
          </p>
        </div>
      </section>

      {/* 戻りリンク */}
      <div className="flex justify-start">
        <Link
          href="/analytics"
          className="text-sm font-bold text-primary hover:underline underline-offset-2"
        >
          ← アニメ分析に戻る
        </Link>
      </div>
    </div>
  );
}

/* ================================================================
   ユーティリティコンポーネント
   ================================================================ */

function MetricCard({
  id,
  badge,
  title,
  source,
  children,
}: {
  id: string;
  badge: string;
  title: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="card p-5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[0.68rem] font-black text-accent uppercase tracking-wide">
          {badge}
        </span>
        <span className="text-[0.68rem] text-muted">出典: {source}</span>
      </div>
      <h3 className="font-black text-base text-ink mb-3">{title}</h3>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function MetricRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-bold text-ink-soft">{label}</dt>
      <dd className="text-ink-soft leading-relaxed">{children}</dd>
    </div>
  );
}
