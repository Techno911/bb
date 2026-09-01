import { createContext, useContext } from "react";
import type { SectionThreadDndState } from "./useSectionThreadDnd";

const SectionThreadDndContext = createContext<SectionThreadDndState | null>(
  null,
);

export const SectionThreadDndProvider = SectionThreadDndContext.Provider;

export function useSidebarThreadDnd(): SectionThreadDndState | null {
  return useContext(SectionThreadDndContext);
}
