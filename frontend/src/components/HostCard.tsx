import { Avatar } from "@/components/Avatar";
import type { AvatarState } from "@/components/Avatar";
import type { AgentMode } from "@/config";
import { cn } from "@/lib/utils";

type Props = {
  avatar: AvatarState;
  level: number;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  voiceProvider: string | null;
};

const STATUS: Record<AvatarState, string> = {
  idle: "Ready when you are", listening: "Listening", thinking: "Looking at the room",
  speaking: "Speaking", error: "Please try again",
};

export function HostCard({ avatar, level, mode, onModeChange, voiceProvider }: Props) {
  return (
    <aside className="host-card on-ink flex min-w-0 flex-col rounded-md bg-ink p-5 text-cream shadow-host">
      <p className="eyebrow text-gold-200">At your service</p>
      <div className="host-portrait my-4 flex min-h-0 justify-center"><Avatar state={avatar} level={level} className="host-avatar" /></div>
      <p className="host-status text-center text-[11px] leading-4 text-cream-dim" role="status">{STATUS[avatar]}</p>
      <h2 className="host-heading display mt-5 text-[30px] leading-8 text-linen">Your visit,<br />beautifully arranged.</h2>
      <p className="host-description mt-3 text-[13px] leading-5 text-cream-dim">I&rsquo;m Mario&rsquo;s virtual host. Let&rsquo;s find your table.</p>
      <div className="host-mode mt-auto pt-5">
        <p className="eyebrow text-gold-200">Your conversation, your way</p>
        <div role="group" aria-label="How to talk to the host" className="mt-2 flex w-full rounded-[4px] border border-ink-500 p-1">
          {(["text", "voice"] as const).map(option => (
            <button key={option} type="button" onClick={() => onModeChange(option)} aria-pressed={mode === option}
              className={cn("min-h-11 flex-1 rounded-[3px] px-3 text-[13px] transition-colors", mode === option ? "bg-linen text-ink" : "text-cream-dim hover:bg-cream/[0.07] hover:text-linen")}>
              {option === "text" ? "Text" : "Voice"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-cream-dim">{mode === "voice" ? "Speak to Mario and hear the replies." : "Type a message, or use the mic to dictate."}</p>
        {mode === "voice" && voiceProvider !== null && <p className="mt-2 text-[10px] leading-4 text-cream-dim">Voice: {voiceProvider}</p>}
      </div>
    </aside>
  );
}
