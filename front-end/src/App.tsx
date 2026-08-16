import { Navigate, Route, Routes } from 'react-router'
import { WardProvider } from './data/WardProvider'
import { AppHeader } from './components/chrome/AppHeader'
import { SafetyFooter } from './components/chrome/SafetyFooter'
import { PatientOverviewBoard } from './screens/PatientOverviewBoard'
import { PatientDetail } from './screens/PatientDetail'
import { ParameterDetail } from './screens/ParameterDetail'

export default function App() {
  return (
    <WardProvider>
    <div className="flex min-h-screen flex-col bg-page">
      <AppHeader />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<PatientOverviewBoard />} />
          <Route path="/patient/:patientId" element={<PatientDetail />} />
          <Route
            path="/patient/:patientId/parameter/:parameterName"
            element={<ParameterDetail />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <SafetyFooter />
    </div>
    </WardProvider>
  )
}
