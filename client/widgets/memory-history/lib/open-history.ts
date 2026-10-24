import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

export const memoryId = (ref: string, at?: string | null) =>
  at ? `memory-${ref}-${Date.parse(at)}` : `memory-${ref}`;

export const useOpenHistory = () => {
  const navigate = useNavigate();
  return (to: string) => (event: MouseEvent<HTMLElement>) => {
    const { currentTarget, target } = event;
    const clickedInPortalMenu =
      target instanceof Element && !currentTarget.contains(target);
    if (
      !(target instanceof Element) ||
      clickedInPortalMenu ||
      target.closest("a, button") ||
      window.getSelection()?.toString()
    ) {
      return;
    }
    void navigate(to);
  };
};

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
