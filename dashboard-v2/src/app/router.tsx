import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { CommandCenter } from '../pages/CommandCenter';
import { PaginaPendente } from '../pages/PaginaPendente';
import { Skeleton } from '../components/feedback/DataState';

// Lazy: páginas que usam Recharts não entram no bundle inicial do Command
// Center (Requisito 19 — performance). Cada rota puxa seu próprio chunk.
const ChampionView = lazy(() => import('../pages/ChampionView').then((m) => ({ default: m.ChampionView })));
const LiveOperations = lazy(() => import('../pages/LiveOperations').then((m) => ({ default: m.LiveOperations })));
const SettlementCapture = lazy(() => import('../pages/SettlementCapture').then((m) => ({ default: m.SettlementCapture })));
const CostIntelligence = lazy(() => import('../pages/CostIntelligence').then((m) => ({ default: m.CostIntelligence })));
const RiskCenter = lazy(() => import('../pages/RiskCenter').then((m) => ({ default: m.RiskCenter })));

function Carregando() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Skeleton height={100} /><Skeleton height={260} /><Skeleton height={260} /></div>;
}
function comSuspense(El: React.LazyExoticComponent<() => React.ReactElement>) {
  return <Suspense fallback={<Carregando />}><El /></Suspense>;
}

/**
 * `AppShell` é ROTA-LAYOUT (Outlet), não repetida em cada rota — bug real
 * encontrado testando no navegador: cada rota tendo seu próprio `<AppShell>`
 * fazia o SSE (`iniciar()`) reconectar do zero em TODA navegação entre
 * páginas, em vez de manter uma conexão estável. Com layout route, o shell
 * (e a conexão SSE que ele abre) monta uma vez só, sobrevive à troca de
 * página — só o conteúdo interno (`<Outlet/>`) troca.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell><Outlet /></AppShell>,
    children: [
      { path: '/', element: <CommandCenter /> },
      { path: '/live', element: comSuspense(LiveOperations) },
      { path: '/strategies', element: <PaginaPendente titulo="Strategy Universe" /> },
      { path: '/champion', element: comSuspense(ChampionView) },
      { path: '/champion-vs-control', element: <PaginaPendente titulo="Champion vs. Control" /> },
      { path: '/arena', element: <PaginaPendente titulo="Challenger Arena" /> },
      { path: '/experiments', element: <PaginaPendente titulo="Experiment Lab" /> },
      { path: '/capture', element: comSuspense(SettlementCapture) },
      { path: '/portfolio', element: <PaginaPendente titulo="Multi-Strategy Portfolio" /> },
      { path: '/opportunities', element: <PaginaPendente titulo="Opportunity Map" /> },
      { path: '/risk', element: comSuspense(RiskCenter) },
      { path: '/costs', element: comSuspense(CostIntelligence) },
      { path: '/system', element: <PaginaPendente titulo="System Health" /> },
      { path: '/audit', element: <PaginaPendente titulo="Audit" /> },
    ],
  },
]);
