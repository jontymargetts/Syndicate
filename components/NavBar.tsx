import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/members", label: "Members" },
  { href: "/bets", label: "Bet Queue" },
];

export default function NavBar({ datasets }: { datasets: { slug: string; name: string }[] }) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight text-slate-900 dark:text-white">
          Syndicate
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            {l.label}
          </Link>
        ))}
        {datasets.length > 0 && (
          <details className="group relative">
            <summary className="cursor-pointer list-none text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
              Data <span aria-hidden>▾</span>
            </summary>
            <div className="absolute left-0 mt-2 min-w-48 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {datasets.map((d) => (
                <Link
                  key={d.slug}
                  href={`/data/${d.slug}`}
                  className="block rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {d.name}
                </Link>
              ))}
            </div>
          </details>
        )}
      </nav>
    </header>
  );
}
