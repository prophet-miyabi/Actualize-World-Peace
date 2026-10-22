// SNS連携・予約投稿の画面で共有する表示用の定義
export const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending: { text: '予約中', className: 'bg-blue-100 text-blue-700' },
  processing: { text: '配信中', className: 'bg-yellow-100 text-yellow-700' },
  done: { text: '配信済み', className: 'bg-green-100 text-green-700' },
  partial: { text: '一部失敗', className: 'bg-amber-100 text-amber-800' },
  failed: { text: '失敗', className: 'bg-red-100 text-red-700' },
  canceled: { text: '取消', className: 'bg-gray-100 text-gray-500' }
};
export const TARGET_LABEL: Record<string, string> = { awp: 'AWP', x: 'X', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' };
export const TARGET_COLOR: Record<string, string> = { awp: '#7c3aed', x: '#111827', instagram: '#db2777', facebook: '#1d4ed8', youtube: '#dc2626', tiktok: '#0f172a' };
