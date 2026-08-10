import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { CommandCenter } from '../pages/CommandCenter';
import { Skeleton } from '../components/feedback/DataState';

// Dashboard FOCADO no plano de 2 exchanges. As páginas do antigo laboratório
// de pesquisa multi-estratégia (Strategy Universe, Challenger Arena, Champion
// vs. Control, Experiment Lab, Pesquisa, Portfolio, Exchanges, Processos,
// Logs, Audit, Live Operations) foram removidas no refactor 2-ex. As páginas
// do bloco "6 exchanges" (Champion, Paper Profit Lab, challengers-timing —
// ChampionView/OpportunityMap/CostIntelligence/RiskCenter/SettlementCapture/
// Historico/SystemHealth) foram ARQUIVADAS — código preservado em
// arquivo-6-exchanges/dashboard-v2-src/, ver README lá. SystemHealth será
// recriada pro sistema atual (snowball-2ex) numa fase separada.
const MaximizacaoLucro = lazy(() => import('../pages/MaximizacaoLucro').then((m) => ({ default: m.MaximizacaoLucro })));
const Competidores = lazy(() => import('../pages/Competidores').then((m) => ({ default: m.Competidores })));

function Carregando() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Skeleton height={100} /><Skeleton height={260} /><Skeleton height={260} /></div>;
}
function comSuspense(El: React.LazyExoticComponent<() => React.ReactElement>) {
  return <Suspense fallback={<Carregando />}><El /></Suspense>;
}

/**
 * `AppShell` é ROTA-LAYOUT (Outlet), montada uma vez só — a conexão de dados
 * e o shell sobrevivem à troca de página; só o `<Outlet/>` interno troca.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell><Outlet /></AppShell>,
    children: [
      { path: '/', element: <CommandCenter /> },
      { path: '/competidores', element: comSuspense(Competidores) },
      { path: '/maximizacao', element: comSuspense(MaximizacaoLucro) },
    ],
  },
]);
