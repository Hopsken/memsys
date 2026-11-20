import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

export const memoryId = (ref: string, versionId?: number | null) =>
  versionId ? `memory-${ref}-${versionId}` : `memory-${ref}`;

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
  const id = Number(searchParams.get("id"));
  const versionId = Number.isInteger(id) && id > 0 ? id : null;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (ref) {
      opened.current = memoryId(ref, versionId);
    } else if (opened.current) {
      document.querySelector<HTMLElement>(`#${opened.current}`)?.focus();
      opened.current = null;
    }
  }, [ref, versionId]);
};
