/**
 * PRZYKŁAD podpięcia. Skopiuj do swojego pliku z server functions i dostosuj
 * do wersji TanStack Start oraz do swojej sesji (getCurrentUser).
 * Zasada: aktora (id + rola) ZAWSZE bierz z sesji na serwerze, nigdy z danych od klienta.
 */
import { createServerFn } from "@tanstack/react-start";
import { createExaminerService } from "./service";
import { netlifyBlobsStorage /*, memoryStorage*/ } from "./storage";
import type { Actor } from "./types";

// TODO: zamień na swoją funkcję zwracającą zalogowanego użytkownika z rolą
declare function getCurrentUser(): Promise<Actor>;

let svc: ReturnType<typeof createExaminerService> | undefined;
async function service() {
  svc ??= createExaminerService(await netlifyBlobsStorage("examiners")); // lub memoryStorage()
  return svc;
}

export const rateStatus = createServerFn({ method: "GET" }).handler(async () => {
  const u = await getCurrentUser();
  return (await service()).rateStatus(u.id);
});

export const submitEntryRequest = createServerFn({ method: "POST" })
  .inputValidator((d: Record<string, string>) => d)
  .handler(async ({ data }) => (await service()).submitEntryRequest(await getCurrentUser(), data));

export const deleteAllRequestsOfPerson = createServerFn({ method: "POST" })
  .inputValidator((d: { examinerId: string }) => d)
  .handler(async ({ data }) => (await service()).deleteAllRequestsOfPerson(await getCurrentUser(), data.examinerId));

// ...analogicznie dla pozostałych metod z service.ts (addExaminer, suspendExaminer,
// requestRemoval, decideRemoval, decideEntryRequest, setLimits, setFrozen, listAudit...).
// Następnie złóż obiekt `api` zgodny z typem Api z ExaminerUI.tsx i przekaż go do komponentów.
