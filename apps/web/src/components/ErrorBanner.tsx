import type { ErrorCode } from '@garfo/shared';
import { TriangleAlert, X } from 'lucide-react';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  RATE_LIMITED:
    'Calma, você enviou mensagens rápido demais. Espere cerca de um minuto e tente de novo.',
  BUDGET_EXCEEDED:
    'A demo atingiu o limite de mensagens de hoje para controlar custos. Volte amanhã; o carrinho continua funcionando.',
  LLM_ERROR: 'O assistente teve um problema para responder. Tente novamente em instantes.',
};

const NETWORK_MESSAGE = 'Não consegui falar com o servidor. Verifique sua conexão e tente de novo.';

export function friendlyErrorMessage(code: ErrorCode | null, fallback: string): string {
  if (code === null) return NETWORK_MESSAGE;
  return MESSAGES[code] ?? fallback;
}

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: { code: ErrorCode | null; message: string };
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto mb-2 flex w-full max-w-3xl items-start max-lg:mr-[4.5rem] max-lg:w-auto gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1">{friendlyErrorMessage(error.code, error.message)}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-m-1 rounded-md p-1 hover:bg-amber-100 dark:hover:bg-amber-900/50"
        aria-label="Fechar aviso"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
