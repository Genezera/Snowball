/**
 * Dicionário PT → EN. A CHAVE é a string em português exatamente como aparece no
 * código; o valor é a tradução em inglês. Em 'pt', t() ignora este dicionário e
 * devolve a própria chave — então adicionar entradas aqui nunca muda a UI em
 * português. Mantido em ordem por área para facilitar revisão.
 */
export const DICT: Record<string, string> = {
  // ── App shell / header ─────────────────────────────────────────────────────
  'PAPER · VIRTUAL · NÃO REAL': 'PAPER · VIRTUAL · NOT REAL',
  'conectando': 'connecting',
  'ao vivo': 'live',
  'reconectando': 'reconnecting',
  'Abrir menu': 'Open menu',
  'Fechar menu': 'Close menu',
  'Conteúdo da página': 'Page content',
  'Trocar idioma': 'Switch language',
  'Idioma': 'Language',

  // ── Sidebar: grupos + rótulos + chrome ─────────────────────────────────────
  'Operações': 'Operations',
  'Estratégias': 'Strategies',
  'Inteligência financeira': 'Financial Intelligence',
  'Sistema': 'System',
  'Processos': 'Processes',
  'Pesquisa': 'Research',
  'Histórico': 'History',
  'Em construção (Etapa B/C)': 'Under construction (Phase B/C)',
  '« Recolher': '« Collapse',
  'Expandir menu': 'Expand menu',
  'Recolher menu': 'Collapse menu',
};
