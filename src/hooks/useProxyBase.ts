import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { isTauri } from "../lib/os";

// The in-process Rust proxy binds a random free port at launch; fetch it once.
export function useProxyBase() {
  const { data } = useQuery({
    queryKey: ["proxyBase"],
    queryFn: () => api.proxyBase(),
    enabled: isTauri(),
    staleTime: Infinity,
    retry: 3,
  });
  return data ?? null;
}
