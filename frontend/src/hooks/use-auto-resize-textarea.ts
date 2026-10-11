import { useCallback, useEffect, useRef } from "react";

type Options = {
  minHeight: number;
  maxHeight?: number;
};

/**
 * Grows a textarea with its content, up to a cap.
 *
 * Extracted from the mock chat component so the composer owns its own sizing and
 * the shell does not have to know about it.
 */
export function useAutoResizeTextarea({ minHeight, maxHeight }: Options) {
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
      const nextHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      );

      textarea.style.height = `${nextHeight}px`;
      // Once the cap is hit the content no longer fits, so let it scroll instead of
      // clipping the caret out of view.
      textarea.style.overflowY =
        textarea.scrollHeight > nextHeight ? "auto" : "hidden";
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
