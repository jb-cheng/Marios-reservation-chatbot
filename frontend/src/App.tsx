import { AdminPage } from '@/pages/AdminPage'
import { ChatPage } from '@/pages/ChatPage'
import { MarketingPage } from '@/pages/MarketingPage'

export default function App({ page }: { page: string }) {
  switch (page) {
    case 'admin':
      return <AdminPage />
    case 'our-story':
    case 'the-menu':
    case 'the-experience':
      return <MarketingPage page={page} />
    default:
      return <ChatPage />
  }
}
