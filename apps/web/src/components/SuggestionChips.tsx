const SUGGESTIONS = [
  'Algo vegetariano até R$ 40',
  'Sushi que chegue em 30 min',
  'Jantar para 2 pessoas sem glúten',
  'Uma sobremesa barata',
] as const;

export function SuggestionChips({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul
      className="grid w-full max-w-xl grid-cols-1 gap-2 max-sm:pr-[4.5rem] sm:grid-cols-2"
      aria-label="Sugestões de pedido"
    >
      {SUGGESTIONS.map((text) => (
        <li key={text}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-medium text-stone-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-brand-500 dark:hover:bg-stone-800 dark:hover:text-brand-300"
          >
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}
