// 特定商取引法に基づく表記（Webでサブスクを販売するために法律上必要）
// 【公開前に必ず】【】部分を記入すること。個人事業主は「請求があれば遅滞なく開示」とする方法も認められている。
export default function Legal() {
  const rows: [string, string][] = [
    ['販売事業者', '【氏名または法人名】'],
    ['運営責任者', '【氏名】'],
    ['所在地', '【住所】（個人事業主の場合、請求があれば遅滞なく開示します）'],
    ['電話番号', '【電話番号】（請求があれば遅滞なく開示します）'],
    ['メールアドレス', '【メールアドレス】'],
    ['販売価格', 'スタンダードプラン 月額2,980円（税込）'],
    ['商品代金以外の必要料金', 'インターネット接続料金・通信料金はお客様のご負担となります'],
    ['支払方法', 'クレジットカード（Stripeによる決済）'],
    ['支払時期', 'お申し込み時に初回分をお支払いいただき、以降は毎月同日に自動更新されます'],
    ['提供時期', 'お支払い完了後、ただちにご利用いただけます'],
    ['解約', 'ダッシュボードの「支払い方法・解約の管理」からいつでも解約できます。解約後は次回更新日以降の請求は発生しません'],
    ['返金', 'サービスの性質上、支払い済みの料金の返金には応じておりません']
  ];
  return (
    <main className="max-w-3xl mx-auto p-6 sm:p-10 bg-white min-h-screen text-gray-800">
      <h1 className="text-2xl font-bold mb-8">特定商取引法に基づく表記</h1>
      <dl className="divide-y border rounded-lg">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-1 sm:grid-cols-3 gap-1 p-4">
            <dt className="font-bold text-sm">{k}</dt>
            <dd className="sm:col-span-2 text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
