export const metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 sm:px-8 py-14">
      <p className="kicker">Terms of Service</p>
      <h1 className="display text-3xl mt-3">利用規約</h1>
      <p className="text-xs text-muted mt-2">最終更新: 2026年6月</p>

      <div className="mt-8 space-y-7 text-[0.92rem] leading-[2] text-ink-soft">
        <p>
          本規約は、「アニメ放送カレンダー」（以下「本サービス」、運営: trifstudio）の利用条件を定めます。利用者は本サービスを利用することで本規約に同意したものとみなされます。
        </p>

        <Sec title="1. サービス内容">
          <p>
            本サービスは、放送中・放送予定のアニメ情報を閲覧し、選択した作品の放送予定をカレンダー購読フィード（ICS形式のURL）として配信する機能を提供します。利用者はこのURLをGoogleカレンダー等に設定することで、放送予定を自動反映できます。
          </p>
        </Sec>

        <Sec title="2. アカウントと認証">
          <p>
            作品の登録機能の利用にはGoogleアカウントでの認証（本人確認のみ）が必要です。利用者は自身のアカウントおよび購読URLの管理に責任を負います。
          </p>
        </Sec>

        <Sec title="3. 禁止事項">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>法令または公序良俗に反する行為</li>
            <li>本サービスの運営を妨げる行為、不正アクセス、過度な自動アクセス</li>
            <li>他者の権利を侵害する行為</li>
          </ul>
        </Sec>

        <Sec title="4. 免責事項">
          <p>
            作品情報・放送日時は外部データ（Annict、しょぼいカレンダー、AniList、MyAnimeList等）に基づくため、正確性・完全性を保証しません。放送時間の変更・中止等により実際と異なる場合があります。本サービスの利用により生じた損害について、運営者は責任を負いません。
          </p>
        </Sec>

        <Sec title="5. サービスの変更・停止">
          <p>運営者は、事前の通知なく本サービスの内容を変更または停止することがあります。</p>
        </Sec>

        <Sec title="6. お問い合わせ">
          <p>本サービスに関するお問い合わせは takeuchi@trifstudio.com まで。</p>
        </Sec>
      </div>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="display text-lg text-ink mb-2">{title}</h2>
      {children}
    </div>
  );
}
