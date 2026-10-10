"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  ImageIcon,
  Paperclip,
  Palette,
  MonitorIcon,
  Sparkles,
  Command,
  SendIcon,
  XIcon,
  LoaderIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CommandSuggestion {
  icon: React.ReactNode;
  label: string;
  description: string;
  prefix: string;
}

// Hoisted out of the component: the list is static, so rebuilding it (and its
// JSX icons) on every render was wasted work and made the command-palette
// effect depend on a value that changed identity each render.
const commandSuggestions: CommandSuggestion[] = [
  {
    icon: <ImageIcon className="h-4 w-4" />,
    label: "Clone UI",
    description: "Generate a UI from a screenshot",
    prefix: "/clone",
  },
  {
    icon: <Palette className="h-4 w-4" />,
    label: "Import Figma",
    description: "Import a design from Figma",
    prefix: "/figma",
  },
  {
    icon: <MonitorIcon className="h-4 w-4" />,
    label: "Create Page",
    description: "Generate a new web page",
    prefix: "/page",
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    label: "Improve",
    description: "Improve existing UI design",
    prefix: "/improve",
  },
];

interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        textarea.style.overflowY = "hidden";
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      );

      textarea.style.height = `${newHeight}px`;
      // Once the cap is hit the content no longer fits, so let it scroll
      // instead of clipping the caret out of view.
      textarea.style.overflowY =
        textarea.scrollHeight > newHeight ? "auto" : "hidden";
    },
    [minHeight, maxHeight],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = `${minHeight}px`;
    }
  }, [minHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  containerClassName?: string;
  showRing?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, containerClassName, showRing = true, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);

    return (
      <div className={cn("relative", containerClassName)}>
        <textarea
          className={cn(
            "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
            "transition-all duration-200 ease-in-out",
            "placeholder:text-muted-foreground",
            "disabled:cursor-not-allowed disabled:opacity-50",
            showRing
              ? "focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
              : "",
            className,
          )}
          ref={ref}
          // Composed rather than overridden: spreading {...props} after these
          // handlers used to replace them, so isFocused never updated and the
          // ring below could not appear.
          onFocus={(event) => {
            setIsFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            props.onBlur?.(event);
          }}
          {...props}
        />

        {showRing && isFocused && (
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-violet-500/30 ring-offset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

export function AnimatedAIChat() {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Keyboard selection is keyed by the query it was made for, so it can never
  // leak a stale highlight into the next "/..." prefix.
  const [nav, setNav] = useState<{ query: string; index: number }>({
    query: "",
    index: -1,
  });
  const [manuallyOpened, setManuallyOpened] = useState(false);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 60,
    maxHeight: 200,
  });
  const [inputFocused, setInputFocused] = useState(false);
  const commandPaletteRef = useRef<HTMLDivElement>(null);
  const thinkingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived during render rather than pushed into state from an effect: the
  // effect version scheduled a second render after every keystroke.
  const paletteQuery =
    value.startsWith("/") && !value.includes(" ") ? value : "";
  const matchedIndex =
    paletteQuery === ""
      ? -1
      : commandSuggestions.findIndex((cmd) => cmd.prefix.startsWith(paletteQuery));
  const activeSuggestion =
    nav.query === paletteQuery ? nav.index : matchedIndex;
  const showCommandPalette =
    manuallyOpened ||
    (paletteQuery !== "" && paletteQuery !== dismissedQuery);

  const dismissPalette = useCallback(() => {
    setManuallyOpened(false);
    setDismissedQuery(paletteQuery === "" ? null : paletteQuery);
  }, [paletteQuery]);

  const selectCommandSuggestion = (index: number) => {
    const selectedCommand = commandSuggestions[index];
    setManuallyOpened(false);
    setDismissedQuery(null);
    setValue(selectedCommand.prefix + " ");
    adjustHeight();
    textareaRef.current?.focus();
  };

  useEffect(() => {
    return () => {
      if (thinkingTimeout.current) clearTimeout(thinkingTimeout.current);
    };
  }, []);

  // Only track the pointer while the textarea has focus. The glow it feeds is
  // rendered on focus alone, so a permanently attached listener re-rendered the
  // whole tree on every mousemove for nothing.
  useEffect(() => {
    if (!inputFocused) return;

    const handleMouseMove = (event: MouseEvent) => {
      setMousePosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [inputFocused]);

  // Attached only while the palette is open, so the handler can name its real
  // dependencies instead of reading them through a ref.
  useEffect(() => {
    if (!showCommandPalette) return;

    const handleClickOutside = (event: MouseEvent) => {
      const palette = commandPaletteRef.current;
      if (!palette) return;

      const target = event.target as Node;
      const commandButton = document.querySelector("[data-command-button]");

      if (palette.contains(target) || commandButton?.contains(target)) return;

      dismissPalette();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showCommandPalette, dismissPalette]);

  const handleSendMessage = () => {
    if (!value.trim()) return;

    startTransition(() => {
      setIsTyping(true);
      // Mock round trip. Clear the previous one so a fast second send cannot
      // leave two timers racing to reset the state.
      if (thinkingTimeout.current) clearTimeout(thinkingTimeout.current);
      thinkingTimeout.current = setTimeout(() => {
        setIsTyping(false);
        setValue("");
        adjustHeight(true);
      }, 3000);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandPalette) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setNav({
          query: paletteQuery,
          index:
            activeSuggestion >= 0 &&
            activeSuggestion < commandSuggestions.length - 1
              ? activeSuggestion + 1
              : 0,
        });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setNav({
          query: paletteQuery,
          index:
            activeSuggestion > 0 ? activeSuggestion - 1 : commandSuggestions.length - 1,
        });
      } else if (event.key === "Tab" || event.key === "Enter") {
        // With no match highlighted, Enter should send rather than swallow the
        // keystroke.
        if (activeSuggestion < 0) {
          if (event.key === "Enter" && value.trim()) {
            event.preventDefault();
            handleSendMessage();
          }
          return;
        }

        event.preventDefault();
        selectCommandSuggestion(activeSuggestion);
      } else if (event.key === "Escape") {
        event.preventDefault();
        dismissPalette();
      }
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (value.trim()) {
        handleSendMessage();
      }
    }
  };

  const handleAttachFile = () => {
    const mockFileName = `file-${Math.floor(Math.random() * 1000)}.pdf`;
    setAttachments((prev) => [...prev, mockFileName]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-transparent p-6 text-white">
      <div
        className="absolute inset-0 h-full w-full overflow-hidden"
        aria-hidden="true"
      >
        <div className="animate-pulse absolute top-0 left-1/4 h-96 w-96 rounded-full bg-violet-500/10 mix-blend-normal blur-[128px] filter" />
        <div className="animate-pulse absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-indigo-500/10 [animation-delay:700ms] mix-blend-normal blur-[128px] filter" />
        <div className="animate-pulse absolute top-1/4 right-1/3 h-64 w-64 rounded-full bg-fuchsia-500/10 [animation-delay:1000ms] mix-blend-normal blur-[96px] filter" />
      </div>

      <div className="relative mx-auto w-full max-w-2xl">
        <motion.div
          className="relative z-10 space-y-12"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div className="space-y-3 text-center">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-block"
            >
              <h1 className="bg-clip-text bg-gradient-to-r from-white/90 to-white/40 pb-1 text-3xl font-medium tracking-tight text-transparent">
                How can I help today?
              </h1>
              <motion.div
                className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "100%", opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
              />
            </motion.div>
            <motion.p
              className="text-sm text-white/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              Type a command or ask a question
            </motion.p>
          </div>

          <motion.div
            className="relative rounded-2xl border border-white/[0.05] bg-white/[0.02] shadow-2xl backdrop-blur-2xl"
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1 }}
          >
            <AnimatePresence>
              {showCommandPalette && (
                <motion.div
                  ref={commandPaletteRef}
                  className="absolute right-4 bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-white/10 bg-black/90 shadow-lg backdrop-blur-xl"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.15 }}
                >
                  <div
                    className="bg-black/95 py-1"
                    role="listbox"
                    aria-label="Command suggestions"
                  >
                    {commandSuggestions.map((suggestion, index) => (
                      <motion.div
                        key={suggestion.prefix}
                        role="option"
                        aria-selected={activeSuggestion === index}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors",
                          activeSuggestion === index
                            ? "bg-white/10 text-white"
                            : "text-white/70 hover:bg-white/5",
                        )}
                        onClick={() => selectCommandSuggestion(index)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.03 }}
                      >
                        <div className="flex h-5 w-5 items-center justify-center text-white/60">
                          {suggestion.icon}
                        </div>
                        <div className="font-medium">{suggestion.label}</div>
                        <div className="ml-1 text-xs text-white/40">
                          {suggestion.prefix}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="p-4">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  adjustHeight();
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Ask zap a question..."
                aria-label="Message"
                containerClassName="w-full"
                className={cn(
                  "w-full px-4 py-3",
                  "resize-none",
                  "bg-transparent",
                  "border-none",
                  "text-white/90 text-sm",
                  "focus:outline-none",
                  "placeholder:text-white/20",
                  "min-h-[60px]",
                )}
                showRing={false}
              />
            </div>

            <AnimatePresence>
              {attachments.length > 0 && (
                <motion.div
                  className="flex flex-wrap gap-2 px-4 pb-3"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {attachments.map((file, index) => (
                    <motion.div
                      key={`${file}-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs text-white/70"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                    >
                      <span>{file}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(index)}
                        aria-label={`Remove ${file}`}
                        className="text-white/40 transition-colors hover:text-white"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between gap-4 border-t border-white/[0.05] p-4">
              <div className="flex items-center gap-3">
                <motion.button
                  type="button"
                  onClick={handleAttachFile}
                  aria-label="Attach file"
                  whileTap={{ scale: 0.94 }}
                  className="group relative rounded-lg p-2 text-white/40 transition-colors hover:text-white/90"
                >
                  <Paperclip className="h-4 w-4" />
                  <span className="absolute inset-0 rounded-lg bg-white/[0.05] opacity-0 transition-opacity group-hover:opacity-100" />
                </motion.button>
                <motion.button
                  type="button"
                  data-command-button
                  aria-label="Toggle commands"
                  aria-expanded={showCommandPalette}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (showCommandPalette) {
                      dismissPalette();
                    } else {
                      setManuallyOpened(true);
                    }
                  }}
                  whileTap={{ scale: 0.94 }}
                  className={cn(
                    "group relative rounded-lg p-2 text-white/40 transition-colors hover:text-white/90",
                    showCommandPalette && "bg-white/10 text-white/90",
                  )}
                >
                  <Command className="h-4 w-4" />
                  <span className="absolute inset-0 rounded-lg bg-white/[0.05] opacity-0 transition-opacity group-hover:opacity-100" />
                </motion.button>
              </div>

              <motion.button
                type="button"
                onClick={handleSendMessage}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                disabled={isTyping || isPending || !value.trim()}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  value.trim()
                    ? "bg-white text-[#0A0A0B] shadow-lg shadow-white/10"
                    : "bg-white/[0.05] text-white/40",
                )}
              >
                {isTyping ? (
                  <LoaderIcon className="h-4 w-4 animate-[spin_2s_linear_infinite]" />
                ) : (
                  <SendIcon className="h-4 w-4" />
                )}
                <span>Send</span>
              </motion.button>
            </div>
          </motion.div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {commandSuggestions.map((suggestion, index) => (
              <motion.button
                key={suggestion.prefix}
                onClick={() => selectCommandSuggestion(index)}
                className="group relative flex items-center gap-2 rounded-lg bg-white/[0.02] px-3 py-2 text-sm text-white/60 transition-all hover:bg-white/[0.05] hover:text-white/90"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                {suggestion.icon}
                <span>{suggestion.label}</span>
                <span className="absolute inset-0 rounded-lg border border-white/[0.05]" />
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {isTyping && (
          <motion.div
            className="fixed bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/[0.05] bg-white/[0.02] px-4 py-2 shadow-lg backdrop-blur-2xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-8 items-center justify-center rounded-full bg-white/[0.05] text-center">
                <span className="mb-0.5 text-xs font-medium text-white/90">
                  zap
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-white/70">
                <span>Thinking</span>
                <TypingDots />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {inputFocused && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none fixed z-0 h-[50rem] w-[50rem] rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 opacity-[0.02] blur-[96px]"
          animate={{ x: mousePosition.x - 400, y: mousePosition.y - 400 }}
          transition={{
            type: "spring",
            damping: 25,
            stiffness: 150,
            mass: 0.5,
          }}
        />
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="ml-1 flex items-center">
      {[1, 2, 3].map((dot) => (
        <motion.div
          key={dot}
          className="mx-0.5 h-1.5 w-1.5 rounded-full bg-white/90"
          initial={{ opacity: 0.3 }}
          animate={{
            opacity: [0.3, 0.9, 0.3],
            scale: [0.85, 1.1, 0.85],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: dot * 0.15,
            ease: "easeInOut",
          }}
          style={{
            boxShadow: "0 0 4px rgba(255, 255, 255, 0.3)",
          }}
        />
      ))}
    </div>
  );
}
