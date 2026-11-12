// Placeholder until block 4 (chat screen). Keeps the build and the Tailwind pipeline exercised.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
      <span aria-hidden className="text-5xl">
        🍴
      </span>
      <h1 className="text-3xl font-bold text-brand-600">Garfo</h1>
      <p className="text-stone-600 dark:text-stone-400">
        Assistente de pedidos com IA. Em construção.
      </p>
    </main>
  );
}
