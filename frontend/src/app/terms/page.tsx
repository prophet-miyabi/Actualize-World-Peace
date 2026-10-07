import Link from 'next/link';

export const metadata = { title: '利用規約 | AWP' };

// 利用規約。
// 【公開前に必ず】【】の部分（運営者情報・日付・管轄裁判所）を記入し、専門家（弁護士）の確認を受けること。
export default function Terms() {
  return (
    <main className="max-w-3xl mx-auto p-6 sm:p-10 bg-white min-h-screen leading-relaxed text-gray-800">
      <h1 className="text-2xl font-bold mb-2">利用規約</h1>
      <p className="text-sm text-gray-500 mb-8">制定日：【2026年◯月◯日】</p>

      <p className="mb-6">
        この利用規約（以下「本規約」）は、【運営者名】（以下「当社」）が提供するAWP（Webサービスおよびスマートフォンアプリ。以下「本サービス」）の利用条件を定めるものです。利用者は、本規約に同意したうえで本サービスを利用するものとします。
      </p>

      <h2 className="text-lg font-bold mt-8 mb-2">第1条（アカウント）</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>利用者は、正確な情報でアカウントを登録し、ログイン情報を自己の責任で管理するものとします。</li>
        <li>1つの携帯電話番号で作成できるアカウントは1つまでです。</li>
        <li>ユーザー名は、他者の名称・商標を誤認させるものや、当社が不適切と判断したものは使用できません。</li>
      </ul>

      <h2 className="text-lg font-bold mt-8 mb-2">第2条（掲載内容の責任）</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>利用者が本サービスで公開するページ・プロフィール・画像・文章（以下「掲載内容」）の責任は、利用者が負います。</li>
        <li>AIが作成した文章・画像も、公開前に利用者自身が内容（事実・価格・実績・表現）を確認するものとします。本サービスのAIは、利用者が確認していない事実を公開しないよう設計していますが、最終的な確認は利用者の責任です。</li>
        <li>掲載内容の著作権は利用者に帰属します。利用者は当社に対し、本サービスの提供・紹介（発見ページやおすすめへの表示を含む）に必要な範囲で、掲載内容を無償で利用することを許諾します。</li>
      </ul>

      <h2 className="text-lg font-bold mt-8 mb-2">第3条（禁止事項）</h2>
      <p className="mb-2">利用者は、次の行為をしてはなりません。</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>法令または公序良俗に違反する行為、犯罪に関わる行為</li>
        <li>事実と異なる、または著しく誇大な表示（存在しない実績・お客様の声・限定性・価格など）。景品表示法、薬機法、特定商取引法その他の表示に関する法令に違反する表示</li>
        <li>他者の著作権・商標権・肖像権・プライバシーその他の権利を侵害する行為</li>
        <li>誹謗中傷、差別、嫌がらせ、わいせつ・暴力的な表現</li>
        <li>詐欺、マルチ商法・無限連鎖講への勧誘、出会いを目的とする勧誘</li>
        <li>なりすまし、不正アクセス、本サービスの運営を妨げる行為、いいね・フォロー・閲覧数の不正な操作</li>
        <li>その他、当社が不適切と判断する行為</li>
      </ul>

      <h2 className="text-lg font-bold mt-8 mb-2">第4条（通報と非公開・削除）</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>各ページ・プロフィールの「通報」から、権利侵害や規約違反を当社に知らせることができます。</li>
        <li>当社は、通報内容その他の情報から本規約に違反すると判断した場合、事前の通知なく掲載内容を非公開にし、またはアカウントを停止できます。非公開にした場合、当社は利用者にその旨を表示します。</li>
        <li>権利侵害に関する申出・異議は、【連絡先メールアドレス】までご連絡ください。</li>
      </ul>

      <h2 className="text-lg font-bold mt-8 mb-2">第5条（提携ツール・広告）</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>本サービスには、提携事業者のサービスを紹介する広告（アフィリエイトリンク）が含まれます。広告であることは画面上に表示します。</li>
        <li>提携ツールの契約・利用は、利用者と各提供元との間で行われ、当社は当事者になりません。</li>
      </ul>

      <h2 className="text-lg font-bold mt-8 mb-2">第6条（有料機能）</h2>
      <p>有料機能の内容・料金・支払方法は、各申し込み画面に表示します。料金・解約条件などの詳細は<Link href="/legal" className="underline">特定商取引法に基づく表記</Link>をご確認ください。</p>

      <h2 className="text-lg font-bold mt-8 mb-2">第7条（サービスの変更・停止）</h2>
      <p>当社は、システムの保守、障害、法令対応その他の理由により、本サービスの全部または一部を変更・停止することがあります。</p>

      <h2 className="text-lg font-bold mt-8 mb-2">第8条（免責）</h2>
      <p>当社は、本サービスに関して利用者と第三者の間で生じた紛争について、当社に故意または重大な過失がある場合を除き、責任を負いません。当社が責任を負う場合でも、当社の責任は、利用者が過去12か月間に当社に支払った金額を上限とします（消費者契約法その他の法令により制限が認められない場合を除く）。</p>

      <h2 className="text-lg font-bold mt-8 mb-2">第9条（規約の変更）</h2>
      <p>当社は、法令の範囲内で本規約を変更できます。重要な変更は、効力発生日の相当期間前に本サービス上でお知らせします。</p>

      <h2 className="text-lg font-bold mt-8 mb-2">第10条（準拠法・管轄）</h2>
      <p>本規約は日本法に準拠し、本サービスに関する紛争は【◯◯地方裁判所】を第一審の専属的合意管轄裁判所とします。</p>

      <h2 className="text-lg font-bold mt-8 mb-2">運営者</h2>
      <p>【運営者名】／【所在地】／【連絡先メールアドレス】</p>

      <p className="mt-10 text-sm"><Link href="/" className="underline text-violet-700">トップへ戻る</Link>・<Link href="/privacy" className="underline text-violet-700">プライバシーポリシー</Link></p>
    </main>
  );
}
