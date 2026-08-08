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

  // ── Command Center (landing) ───────────────────────────────────────────────
  'Command Center': 'Command Center',
  'Visão executiva do Champion (paper) e do Paper Profit Lab (virtual) — nunca misturados.': 'Executive view of the Champion (paper) and the Paper Profit Lab (virtual) — never mixed.',
  'sistema saudável': 'system healthy',
  'dado stale': 'stale data',
  'atenção': 'attention',
  'Capital · PAPER': 'Capital · PAPER',
  'PnL realizado': 'Realized PnL',
  'Equity mark': 'Mark equity',
  'Equity liquidação': 'Liquidation equity',
  'Margem em uso': 'Margin in use',
  'Exposição (notional)': 'Exposure (notional)',
  'Posições': 'Positions',
  'em risco': 'at risk',
  'Curva de capital (paper)': 'Capital curve (paper)',
  'Capital inicial': 'Initial capital',
  'atual': 'current',
  'custos': 'costs',
  'Motores': 'Engines',
  'Champion (paper), challengers (paper lab) e experimentos — nunca somados.': 'Champion (paper), challengers (paper lab) and experiments — never summed.',
  'Posições abertas': 'Open positions',
  'ver cockpit →': 'view cockpit →',
  'liq': 'liq',
  'Nenhuma posição aberta.': 'No open positions.',
  'Próximos settlements': 'Upcoming settlements',
  'Nenhum settlement iminente.': 'No imminent settlement.',
  'Oportunidades': 'Opportunities',
  'ver mapa →': 'view map →',
  'Observadas': 'Observed',
  'Elegíveis': 'Eligible',
  'Coletor': 'Collector',
  'Carregando coletor…': 'Loading collector…',
  'Melhor / pior motor (janela comum)': 'Best / worst engine (common window)',
};
