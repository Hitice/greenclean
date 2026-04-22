/**
 * Modos de IA: free (só heurística), cloud (API paga GreenClean), advanced (chave própria / Ollama).
 */
export const PLAN_MODES = {
  free: { id: 'free', label: 'Gratuito — só heurística (sem chaves)' },
  cloud: { id: 'cloud', label: 'IA na nuvem (plano pago / token)' },
  advanced: { id: 'advanced', label: 'Avançado — chave própria ou Ollama local' },
};

/** Base de API de nuvem padrão (vazio: usuário preenche após assinar). */
export const DEFAULT_CLOUD_API_BASE = '';

/** Link do site para assinatura / obter token (altere no fork). */
export const CLOUD_SUBSCRIBE_URL = 'https://example.com/assine';
