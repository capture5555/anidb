export const metadata = { title: "このサイトについて" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 sm:px-8 py-14">
      <p className="kicker">About</p>
      <h1 className="display text-3xl mt-3">このサイトについて</h1>

      <div className="mt-8 space-y-7 text-[0.95rem] leading-[2] text-ink-soft">
        <p>
          放送中・放送予定のアニメ情報をまとめて見渡し、気になった作品だけをカレンダーに反映するための、社内・身内向けのサイトです。視聴記録のためのサービスではありません。
        </p>
        <div>
          <h2 className="display text-lg text-ink mb-2">使い方</h2>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>トップでタブ（今期・来期・映画）を切り替えて作品を探します。</li>
            <li>作品をクリックすると、あらすじ・キャスト・スタッフ・放送情報が見られます。</li>
            <li>「カレンダーに登録」を押すと、その作品が選択リストに追加されます。</li>
            <li>
              初回のみ、マイページの「カレンダー購読URL」をGoogleカレンダーの「URLで追加」に設定します。以後の操作は不要です。
            </li>
          </ol>
        </div>
        <div>
          <h2 className="display text-lg text-ink mb-2">登録後について</h2>
          <p>
            登録した作品の放送予定は、購読URLを通じてカレンダーへ自動で反映され続けます。新しい放送回も自動で追加され、作品を解除すれば予定も自動で消えます。
            反映のタイミングはGoogleカレンダー側の取得間隔に依存するため、変更が表示されるまで最大24時間程度かかることがあります。
            本サービスがあなたのカレンダーの中身にアクセスすることはありません。
          </p>
        </div>
        <div>
          <h2 className="display text-lg text-ink mb-2">データの出典</h2>
          <p>
            作品情報は Annict、放送スケジュールは しょぼいカレンダー のデータを利用しています。
          </p>
        </div>
      </div>
    </div>
  );
}
