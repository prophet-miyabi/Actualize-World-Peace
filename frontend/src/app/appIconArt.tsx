// アプリアイコンの絵柄（ImageResponse用。Tailwindは使えないためインラインスタイルのみ）。
// 角丸はホーム画面側で付くため、全面をグラデーションで塗る
export function AppIconArt({ size }: { size: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #d946ef 0%, #7c3aed 50%, #0ea5e9 100%)',
        color: '#ffffff',
        fontSize: size * 0.34,
        fontWeight: 900,
        letterSpacing: size * -0.01
      }}
    >
      AWP
    </div>
  );
}
