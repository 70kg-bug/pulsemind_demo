import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { WardProvider } from './data/WardProvider'
import { AppHeader } from './components/chrome/AppHeader'
import { ErrorBoundary } from './components/chrome/ErrorBoundary'
import { SafetyFooter } from './components/chrome/SafetyFooter'
import { SimulationBar } from './components/chrome/SimulationBar'
import { TelemetryDock } from './components/chrome/TelemetryDock'
import { PatientOverviewBoard } from './screens/PatientOverviewBoard'
import { PatientDetail } from './screens/PatientDetail'
import { ParameterDetail } from './screens/ParameterDetail'

/**
 * The shell.
 *
 * AT `xl` AND ABOVE THE PAGE DOES NOT SCROLL. It is exactly one viewport tall,
 * and the board fills what is left between the chrome; anything long scrolls
 * inside its own pane. A ward board whose beds run off the bottom fails at the
 * one job it has, and ICU staff are interrupted often enough that a glance must
 * not begin with a scroll.
 *
 * Below `xl` this stays an ordinary scrolling page: the aside already stacks
 * under the triage list there, and a small-screen no-scroll layout would be a
 * different design rather than this one made narrow.
 *
 * Two things are load-bearing here.
 *
 * `min-h-0` on `main`: a flex child's default `min-height:auto` refuses to
 * shrink below its content, so without it the pane grows to fit the board and
 * the page scrolls again — the overflow rule never gets the chance to apply.
 *
 * `fixed inset-0` rather than `h-[100dvh]`: height alone left the document with
 * a scroll range of its own on the long patient screen, so the window scrolled
 * AND the pane scrolled, which is worse than either. Out of flow, `body` has no
 * content height and the document cannot scroll at all — the panes are the only
 * things that can.
 */
export default function App() {
  // Lifted out of SimulationBar because the control and the panel are on
  // opposite sides of <main>. The control lives in the chrome that already
  // exists, so a closed dock costs the board no height at all.
  const [pipelineOpen, setPipelineOpen] = useState(false)

  return (
    <WardProvider>
      <div className="flex min-h-screen flex-col bg-page xl:fixed xl:inset-0 xl:min-h-0 xl:overflow-hidden">
        <div className="shrink-0">
          <AppHeader />
          <SimulationBar
            pipelineOpen={pipelineOpen}
            onTogglePipeline={() => setPipelineOpen((was) => !was)}
          />
        </div>
        <main className="flex-1 xl:min-h-0 xl:overflow-y-auto">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<PatientOverviewBoard />} />
              <Route path="/patient/:patientId" element={<PatientDetail />} />
              <Route
                path="/patient/:patientId/parameter/:parameterName"
                element={<ParameterDetail />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
        <TelemetryDock open={pipelineOpen} onClose={() => setPipelineOpen(false)} />
        <SafetyFooter />
      </div>
    </WardProvider>
  )
}
