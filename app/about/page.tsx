export const metadata = { title: "このサイトについて" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 sm:px-8 py-14">
      <p className="kicker">About</p>
      <h1 className="display text-3xl mt-3">このサイトについて</h1>

      <div className="mt-8 space-y-7 text-[0.95rem] leading-[2] text-ink-soft">
        <p>
          放送中・放送予定のアニメ情報をまとめて見渡し、気になった作品だけをGoogleカレンダーへ登録するための、社内・身内向けのサイトです。視聴記録のためのサービスではありません。
        </p>
        <div>
          <h2 className="display text-lg text-ink mb-2">使い方</h2>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>トップでタブ（今期・来期・放送中・放送予定）を切り替えて作品を探します。</li>
            <li>作品をクリックすると、あらすじ・キャスト・スタッフ・放送情報が見られます。</li>
            <li>「Googleカレンダーへ追加」を押すと、登録先カレンダーを選んで予定を登録できます。</li>
          </ol>
        </div>
        <div>
          <h2 className="display text-lg text-ink mb-2">登録後について</h2>
          <p>
            一度登録すると、PCを起動していなくても、新しい放送回が自動でカレンダーに追加されます。同じ予定が重複して登録されることはありません。
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
