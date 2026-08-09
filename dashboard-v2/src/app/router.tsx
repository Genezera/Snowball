import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { CommandCenter } from '../pages/CommandCenter';
import { Skeleton } from '../components/feedback/DataState';

// Lazy: cada rota puxa seu próprio chunk — o Command Center (inicial) nunca
// carrega o código das outras páginas. As 6 páginas originais + as 12 novas
// da reconstrução, todas reais (nenhum placeholder restante).
const ChampionView = lazy(() => import('../pages/ChampionView').then((m) => ({ default: m.ChampionView })));
const MaximizacaoLucro = lazy(() => import('../pages/MaximizacaoLucro').then((m) => ({ default: m.MaximizacaoLucro })));
const Competidores = lazy(() => import('../pages/Competidores').then((m) => ({ default: m.Competidores })));
const LiveOperations = lazy(() => import('../pages/LiveOperations').then((m) => ({ default: m.LiveOperations })));
const SettlementCapture = lazy(() => import('../pages/SettlementCapture').then((m) => ({ default: m.SettlementCapture })));
const CostIntelligence = lazy(() => import('../pages/CostIntelligence').then((m) => ({ default: m.CostIntelligence })));
const RiskCenter = lazy(() => import('../pages/RiskCenter').then((m) => ({ default: m.RiskCenter })));
const StrategyUniverse = lazy(() => import('../pages/StrategyUniverse').then((m) => ({ default: m.StrategyUniverse })));
const ChallengerArena = lazy(() => import('../pages/ChallengerArena').then((m) => ({ default: m.ChallengerArena })));
const ChampionVsControl = lazy(() => import('../pages/ChampionVsControl').then((m) => ({ default: m.ChampionVsControl })));
const ExperimentLab = lazy(() => import('../pages/ExperimentLab').then((m) => ({ default: m.ExperimentLab })));
const Portfolio = lazy(() => import('../pages/Portfolio').then((m) => ({ default: m.Portfolio })));
const OpportunityMap = lazy(() => import('../pages/OpportunityMap').then((m) => ({ default: m.OpportunityMap })));
const Exchanges = lazy(() => import('../pages/Exchanges').then((m) => ({ default: m.Exchanges })));
const Processos = lazy(() => import('../pages/Processos').then((m) => ({ default: m.Processos })));
const SystemHealth = lazy(() => import('../pages/SystemHealth').then((m) => ({ default: m.SystemHealth })));
const Historico = lazy(() => import('../pages/Historico').then((m) => ({ default: m.Historico })));
const Logs = lazy(() => import('../pages/Logs').then((m) => ({ default: m.Logs })));
const Audit = lazy(() => import('../pages/Audit').then((m) => ({ default: m.Audit })));
const Pesquisa = lazy(() => import('../pages/Pesquisa').then((m) => ({ default: m.Pesquisa })));

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
      { path: '/champion', element: comSuspense(ChampionView) },
      { path: '/maximizacao', element: comSuspense(MaximizacaoLucro) },
      { path: '/competidores', element: comSuspense(Competidores) },
      { path: '/live', element: comSuspense(LiveOperations) },
      { path: '/capture', element: comSuspense(SettlementCapture) },
      { path: '/opportunities', element: comSuspense(OpportunityMap) },
      { path: '/portfolio', element: comSuspense(Portfolio) },
      { path: '/strategies', element: comSuspense(StrategyUniverse) },
      { path: '/arena', element: comSuspense(ChallengerArena) },
      { path: '/champion-vs-control', element: comSuspense(ChampionVsControl) },
      { path: '/experiments', element: comSuspense(ExperimentLab) },
      { path: '/costs', element: comSuspense(CostIntelligence) },
      { path: '/risk', element: comSuspense(RiskCenter) },
      { path: '/exchanges', element: comSuspense(Exchanges) },
      { path: '/processes', element: comSuspense(Processos) },
      { path: '/system', element: comSuspense(SystemHealth) },
      { path: '/pesquisa', element: comSuspense(Pesquisa) },
      { path: '/historico', element: comSuspense(Historico) },
      { path: '/logs', element: comSuspense(Logs) },
      { path: '/audit', element: comSuspense(Audit) },
    ],
  },
]);
