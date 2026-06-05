export const metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 sm:px-8 py-14">
      <p className="kicker">Privacy Policy</p>
      <h1 className="display text-3xl mt-3">プライバシーポリシー</h1>
      <p className="text-xs text-muted mt-2">最終更新: 2026年6月</p>

      <div className="mt-8 space-y-7 text-[0.92rem] leading-[2] text-ink-soft">
        <p>
          本ポリシーは、「アニメ放送カレンダー」（以下「本サービス」）における利用者情報の取り扱いについて定めるものです。運営者は trifstudio（連絡先: takeuchi@trifstudio.com）です。
        </p>

        <Sec title="1. 取得する情報">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Googleアカウントのメールアドレスおよび基本プロフィール（本人確認のため）</li>
            <li>
              Googleカレンダーへのアクセス: カレンダー一覧の読み取り、および<strong>本サービスが作成した予定の作成・更新・削除</strong>
            </li>
            <li>利用者が選択した「登録作品」「登録先カレンダー」などの設定情報</li>
          </ul>
          <p className="mt-2">
            閲覧のみの利用ではアカウント情報は取得しません。情報を取得するのは「Googleカレンダーへ追加」を実行したときのみです。
          </p>
        </Sec>

        <Sec title="2. 利用目的">
          <p>
            利用者が選択したアニメ作品の放送予定を、利用者のGoogleカレンダーへ登録・更新するためにのみ使用します。サブタイトルや放送時間が後から判明した場合の予定更新を含みます。
          </p>
        </Sec>

        <Sec title="3. Google ユーザーデータの取り扱い（Limited Use）">
          <p>
            本サービスによる Google API から取得した情報の使用および他者への移転は、
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="link-underline"
            >
              Google API Services User Data Policy
            </a>
            （Limited Use 要件を含む）に準拠します。取得した情報を広告目的に利用したり、第三者へ販売・提供することはありません。
          </p>
        </Sec>

        <Sec title="4. 情報の保存とセキュリティ">
          <p>
            カレンダー操作に必要な認証情報（リフレッシュトークン）は<strong>暗号化して保存</strong>し、サーバー側の処理でのみ使用します。保持する情報は目的に必要な最小限に限ります。
          </p>
        </Sec>

        <Sec title="5. 第三者提供">
          <p>法令に基づく場合を除き、利用者情報を第三者へ提供することはありません。</p>
        </Sec>

        <Sec title="6. アクセス権の取り消し・削除">
          <p>
            利用者はいつでも本サービスの「マイ登録」から登録を解除できます。また
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="link-underline"
            >
              Googleアカウントのセキュリティ設定
            </a>
            から本サービスのアクセス権を取り消せます。取り消し後、保存された認証情報は無効化されます。削除の依頼は上記連絡先まで。
          </p>
        </Sec>

        <Sec title="7. データの出典">
          <p>
            作品情報・放送情報・評価は Annict、しょぼいカレンダー、AniList、MyAnimeList（Jikan API）の各サービスから取得しています。
          </p>
        </Sec>

        <Sec title="8. 改定">
          <p>本ポリシーは必要に応じて改定されます。重要な変更がある場合は本ページで告知します。</p>
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
