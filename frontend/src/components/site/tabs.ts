import type { KeyboardEvent } from "react";

/**
 * Arrow keys inside a tab strip.
 *
 * role="tablist" promises the keyboard behaviour of a native tab strip: one stop
 * in the tab order, arrows to move along it. Without this the markup announces
 * itself as a tab strip to a screen reader and then behaves like a row of
 * ordinary buttons, so a keyboard user has to tab through every option to reach
 * the panel.
 *
 * The next tab is found from the DOM rather than from an id convention, so the
 * two strips on this page can name their panels differently.
 */
export function tabKeyDown(
  event: KeyboardEvent<HTMLElement>,
  keys: readonly string[],
  active: string,
  onSelect: (key: string) => void,
  vertical = false,
): void {
  const index = keys.indexOf(active);
  if (index < 0) return;

  const forward = vertical ? "ArrowDown" : "ArrowRight";
  const back = vertical ? "ArrowUp" : "ArrowLeft";
  let next: number;
  if (event.key === forward) next = (index + 1) % keys.length;
  else if (event.key === back) next = (index - 1 + keys.length) % keys.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = keys.length - 1;
  else return;

  event.preventDefault();
  onSelect(keys[next]);
  // The buttons already exist; only their selected state changes, so focus can
  // move now rather than waiting for the panel animation.
  event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
}