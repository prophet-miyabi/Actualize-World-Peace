import { redirect } from 'next/navigation';

// 以前のStripeによる月額プランの画面。有料プランは /plans（自前の請求: 銀行振込・キャッシュ）に移った
export default function Billing() {
  redirect('/plans');
}
