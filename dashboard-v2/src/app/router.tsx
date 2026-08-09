import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { CommandCenter } from '../pages/CommandCenter';
import { Skeleton } from '../components/feedback/DataState';

// Dashboard FOCADO no plano de 2 exchanges. Núcleo (4) + operação/mercado (6).
// As páginas do antigo laboratório de pesquisa multi-estratégia (Strategy
// Universe, Challenger Arena, Champion vs. Control, Experiment Lab, Pesquisa,
// Portfolio, Exchanges, Processos, Logs, Audit, Live Operations) foram
// removidas no refactor 2-ex.
const ChampionView = lazy(() => import('../pages/ChampionView').then((m) => ({ default: m.ChampionView })));
const MaximizacaoLucro = lazy(() => import('../pages/MaximizacaoLucro').then((m) => ({ default: m.MaximizacaoLucro })));
const Competidores = lazy(() => import('../pages/Competidores').then((m) => ({ default: m.Competidores })));
const OpportunityMap = lazy(() => import('../pages/OpportunityMap').then((m) => ({ default: m.OpportunityMap })));
const CostIntelligence = lazy(() => import('../pages/CostIntelligence').then((m) => ({ default: m.CostIntelligence })));
const RiskCenter = lazy(() => import('../pages/RiskCenter').then((m) => ({ default: m.RiskCenter })));
const SettlementCapture = lazy(() => import('../pages/SettlementCapture').then((m) => ({ default: m.SettlementCapture })));
const Historico = lazy(() => import('../pages/Historico').then((m) => ({ default: m.Historico })));
const SystemHealth = lazy(() => import('../pages/SystemHealth').then((m) => ({ default: m.SystemHealth })));

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
      { path: '/champion', element: comSuspense(ChampionView) },
      { path: '/opportunities', element: comSuspense(OpportunityMap) },
      { path: '/costs', element: comSuspense(CostIntelligence) },
      { path: '/risk', element: comSuspense(RiskCenter) },
      { path: '/capture', element: comSuspense(SettlementCapture) },
      { path: '/historico', element: comSuspense(Historico) },
      { path: '/system', element: comSuspense(SystemHealth) },
    ],
  },
]);
