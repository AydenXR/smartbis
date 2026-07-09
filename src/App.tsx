import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import { AuthProvider } from '@/contexts/AuthContext'
import Home from '@/pages/Home'
import Landing from '@/pages/Landing'
import Login from '@/pages/Login'
import Register from '@/pages/Register'

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/workspace"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route path="/dashboard" element={<Navigate to="/workspace" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
