import { ArrowDown, ArrowLeftRight, Bot, Database, Globe, Monitor, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';

function Node({
  icon,
  title,
  children,
  tone = 'plain',
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  tone?: 'plain' | 'brand';
}) {
  const toneClass =
    tone === 'brand'
      ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30'
      : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900';
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${toneClass}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-brand-700 dark:text-brand-400" aria-hidden>
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-stone-300">{children}</p>
    </div>
  );
}

function Link({ label, both }: { label: string; both?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1.5 text-xs text-stone-500 dark:text-stone-400">
      {both ? (
        <ArrowLeftRight className="h-4 w-4 rotate-90" aria-hidden />
      ) : (
        <ArrowDown className="h-4 w-4" aria-hidden />
      )}
      <span>{label}</span>
    </div>
  );
}

/** Architecture drawn with plain HTML and Tailwind (D5.2): no diagram library, works in dark mode. */
export function ArchitectureDiagram() {
  return (
    <figure className="rounded-2xl border border-stone-200 bg-stone-100/60 p-3 sm:p-5 dark:border-stone-800 dark:bg-stone-900/50">
      <div className="mx-auto max-w-2xl">
        <Node icon={<Monitor className="h-4 w-4" />} title="Navegador">
          Você escreve o que quer comer e vê a resposta aparecendo aos poucos.
        </Node>
        <Link label="HTTP" />
        <Node icon={<Globe className="h-4 w-4" />} title="Web (Next.js)">
          Chat, cards de pratos e carrinho ao vivo. O botão &quot;Adicionar&quot; e o checkout falam
          direto com a API, sem passar pelo agente.
        </Node>
        <Link label="POST /chat (streaming SSE) e REST do carrinho" />

        <div className="rounded-2xl border-2 border-dashed border-stone-300 p-2.5 sm:p-3 dark:border-stone-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            API (NestJS)
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <Node
                icon={<Bot className="h-4 w-4" />}
                title="ChatController + AgentService"
                tone="brand"
              >
                O loop de tool calling, escrito à mão: no máximo 6 voltas por mensagem.
              </Node>
              <Link label="pede texto e tools" both />
              <Node icon={<Bot className="h-4 w-4" />} title="LlmProvider">
                Interface própria: OpenAI com chave, modo demonstração sem chave.
              </Node>
              <Link label="valida e executa" />
              <Node icon={<Wrench className="h-4 w-4" />} title="ToolRegistry (7 tools)">
                Valida os argumentos com Zod, aplica timeout de 10 s e devolve erros como resultado.
              </Node>
            </div>
            <div className="flex flex-col max-md:mt-2">
              <Node icon={<Globe className="h-4 w-4" />} title="Controllers REST">
                Catálogo, carrinho e checkout. É aqui que o usuário confirma o pedido.
              </Node>
              <Link label="regras de negócio" />
              <div className="grid gap-2">
                <Node icon={<Database className="h-4 w-4" />} title="SearchService">
                  Filtros no SQL (preço, tags, alergênicos, tempo) mais similaridade vetorial.
                </Node>
                <Node icon={<Database className="h-4 w-4" />} title="CartService">
                  Um restaurante por carrinho, quantidade de 1 a 10, pedido mínimo.
                </Node>
              </div>
              <p className="mt-2 text-xs text-stone-500 dark:text-stone-400 md:mt-auto md:pt-2">
                As tools do agente chamam os mesmos services que o REST.
              </p>
            </div>
          </div>
        </div>

        <Link label="SQL parametrizado" />
        <Node icon={<Database className="h-4 w-4" />} title="PostgreSQL + pgvector">
          Restaurantes, pratos com embeddings (1536 dimensões), carrinhos e conversas.
        </Node>
      </div>
    </figure>
  );
}
