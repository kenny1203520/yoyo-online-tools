"use client";
import { createContext, useContext } from "react";
type Category = "all" | "image" | "text" | "developer" | "3d";
export const DirectoryContext = createContext<{
  query: string; setQuery: (value: string) => void;
  category: Category; setCategory: (value: Category) => void;
} | null>(null);
export function useDirectoryState() {
  const state = useContext(DirectoryContext);
  if (!state) throw new Error("Missing directory provider");
  return state;
}
