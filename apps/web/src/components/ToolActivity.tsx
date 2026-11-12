import { Check, Loader2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { ToolRun } from '@/stores/chat.store';

/** Discreet line per tool call: spinner while running, check (or warning) when done. */
export function ToolActivity({ tools }: { tools: ToolRun[] }) {
  if (tools.length === 0) return null;
  return (
    <ul className="mb-2 space-y-1" aria-label="Atividade do assistente">
      {tools.map((tool) => (
        <li
          key={tool.id}
          className={clsx(
            'flex items-center gap-2 text-xs transition-opacity',
            tool.done ? 'text-stone-500 dark:text-stone-400' : 'text-brand-800 dark:text-brand-300',
          )}
        >
          {!tool.done ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : tool.ok ? (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
          )}
          <span>{tool.label}</span>
        </li>
      ))}
    </ul>
  );
}
