// 特定商取引法に基づく表記（AWPの有料プランを販売するために法律上必要）
// 【公開前に必ず】【】部分を記入すること。個人事業主は「請求があれば遅滞なく開示」とする方法も認められている。
// 料金は管理画面の設定から自動で表示する（表記と実際の料金がずれないように）
const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';

async function planText() {
  try {
    const res = await fetch(`${API}/plans/public`, { cache: 'no-store' });
    const d = (await res.json()) as { plans: { label: string; priceYen: number }[]; months: number[] };
    return `${d.plans.map((p) => `${p.label}プラン 月額${p.priceYen.toLocaleString('ja-JP')}円`).join('／')}（税込。${d.months.join('・')}か月分を前払い）`;
  } catch {
    return '料金ページ（/plans）に表示する金額（税込）';
  }
}

export default async function Legal() {
  const rows: [string, string][] = [
    ['販売事業者', '【氏名または法人名】'],
    ['運営責任者', '【氏名】'],
    ['所在地', '【住所】（個人事業主の場合、請求があれば遅滞なく開示します）'],
    ['電話番号', '【電話番号】（請求があれば遅滞なく開示します）'],
    ['メールアドレス', '【メールアドレス】'],
    ['販売価格', await planText()],
    ['商品代金以外の必要料金', '銀行振込の手数料、インターネット接続料金・通信料金はお客様のご負担となります'],
    ['支払方法', '銀行振込、またはAWPのキャッシュ'],
    ['支払時期', 'お申し込み時に、選んだ期間分を前払い（銀行振込はお申し込みから14日以内）'],
    ['提供時期', 'キャッシュでのお支払いはただちに、銀行振込は入金を確認したのち（通常1〜2営業日）ご利用いただけます'],
    ['自動更新・解約', '自動更新はありません。期間が終わると無料プランに戻ります'],
    ['返金', '前払いのため、支払い済みの料金の返金には応じておりません（法令で定める場合を除く）'],
    ['利用者どうしの売買について', 'AWPのショップでの売買は、出品者とお客様の間の契約です。各出品者の表記は、それぞれのページの「特定商取引法に基づく表記」をご確認ください']
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
