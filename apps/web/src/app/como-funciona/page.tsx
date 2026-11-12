import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';

export const metadata: Metadata = { title: 'Como funciona — Garfo' };

// Provisional page: the full version (diagram, tools, eval results) arrives in block 5.
export default function HowItWorksPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Como funciona</h1>
        <p className="mt-4 text-stone-600 dark:text-stone-300">
          O Garfo é um agente de IA com tool calling: ele busca pratos reais no banco (filtros
          estruturados mais busca semântica com pgvector), recomenda no máximo três e adiciona ao
          carrinho quando você pede. Quem finaliza o pedido é você, pelo botão.
        </p>
        <p className="mt-4 text-stone-600 dark:text-stone-300">
          Esta página ganha o diagrama da arquitetura, as 7 tools e o resultado da avaliação em
          breve.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-11 items-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Voltar ao chat
        </Link>
      </main>
    </>
  );
}
