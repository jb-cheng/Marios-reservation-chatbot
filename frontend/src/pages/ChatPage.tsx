import { ChatPanel } from "@/components/ChatPanel";
import { AnimatedAIChat } from "@/components/ui/animated-ai-chat";

// The shell paints light text on translucent surfaces over a transparent
// background, so it needs a dark page behind it to stay legible.
export function ChatPage() {
  return (
    <main className="min-h-screen bg-[#0B0908]">
      <AnimatedAIChat>
        <ChatPanel />
      </AnimatedAIChat>
    </main>
  );
}
