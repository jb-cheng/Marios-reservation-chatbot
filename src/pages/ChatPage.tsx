import { AnimatedAIChat } from '@/components/ui/animated-ai-chat'

// The component paints white text and translucent surfaces on a transparent
// background, so it needs a dark page behind it to stay legible.
export function ChatPage() {
  return (
    <main className="min-h-screen bg-[#0A0A0B]">
      <AnimatedAIChat />
    </main>
  )
}
