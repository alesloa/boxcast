import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { isTauri } from "../lib/os";

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.getCatalog(false),
    enabled: isTauri(),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });
}
