import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

// Row links carry this id so focus can return to them. A list that shows a
// memory more than once, as Activity does, tells its rows apart by `at`.
export const memoryId = (ref: string, at?: string | null) =>
  at ? `memory-${ref}-${Date.parse(at)}` : `memory-${ref}`;

// A row opens its history when clicked anywhere, unless the click selected
// text or landed on one of the row's own controls. Menus render in a portal,
// so their clicks bubble through React but not through the row's DOM.
export const useOpenHistory = () => {
  const navigate = useNavigate();
  return (to: string) => (event: MouseEvent<HTMLElement>) => {
    const { currentTarget, target } = event;
    if (
      !(target instanceof Element) ||
      !currentTarget.contains(target) ||
      target.closest("a, button") ||
      window.getSelection()?.toString()
    ) {
      return;
    }
    void navigate(to);
  };
};

// The dialog is a child route; when it closes, focus returns to the row
// that opened it.
export const useReturnFocus = () => {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const at = searchParams.get("at");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (ref) {
      opened.current = memoryId(ref, at);
    } else if (opened.current) {
      document.querySelector<HTMLElement>(`#${opened.current}`)?.focus();
      opened.current = null;
    }
  }, [ref, at]);
};
