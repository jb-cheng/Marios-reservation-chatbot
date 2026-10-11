import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminPage } from '@/pages/AdminPage'
import { ChatPage } from '@/pages/ChatPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The agent is the product here, so it owns the root. The staff queue is
            a separate route because it must never be one click away from a
            customer's conversation. */}
        <Route path="/" element={<ChatPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
