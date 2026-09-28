import Logo from '@/components/Logo';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-8 py-4 flex items-center gap-3">
        <Logo size={28} />
        <span className="text-gray-400 font-bold">Dashboard</span>
      </header>
      <main className="p-8 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
