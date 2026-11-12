import { BookOpen, RotateCcw, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { GITHUB_URL } from '@/lib/env';
import { GithubIcon } from './GithubIcon';

const linkClass =
  'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50';

export function Header({ onNewChat }: { onNewChat?: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-stone-200 bg-white/80 px-3 backdrop-blur sm:px-5 dark:border-stone-800 dark:bg-stone-950/80">
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-lg"
        aria-label="Garfo, página inicial"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
          <UtensilsCrossed className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-lg font-bold tracking-tight">Garfo</span>
      </Link>
      <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Principal">
        <Link href="/como-funciona" className={linkClass}>
          <BookOpen className="h-4 w-4 sm:hidden" aria-hidden />
          <span className="hidden sm:inline">Como funciona</span>
          <span className="sr-only sm:hidden">Como funciona</span>
        </Link>
        {GITHUB_URL && (
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            aria-label="Código no GitHub"
          >
            <GithubIcon className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        )}
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-300 px-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Nova conversa</span>
            <span className="sr-only sm:hidden">Nova conversa</span>
          </button>
        )}
      </nav>
    </header>
  );
}
