import type { Repo } from "../db/repo";
import type { Logger } from "../lib/logger";
import type { StatusEvent } from "../whatsapp/types";

/** Pricing que indica possível cobrança (R1). */
export function isPaidPricing(p: NonNullable<StatusEvent["pricing"]>): boolean {
  return p.billable === true || p.type === "regular" || p.category !== "service";
}

/** Grava pricing no outbound_log; se for pago, liga a trava manual na hora. */
export async function handleStatusEvent(
  ev: StatusEvent,
  deps: { repo: Repo; logger: Logger; phoneNumberId: string; now?: () => Date },
): Promise<void> {
  const p = ev.pricing;
  if (!p) return;
  const now = (deps.now ?? (() => new Date()))();
  // A trava vem primeiro: nada pode atrasá-la.
  if (isPaidPricing(p)) {
    await deps.repo.setManualLock(
      deps.phoneNumberId,
      `status com pricing pago: billable=${String(p.billable)} type=${String(p.type)} category=${String(p.category)}`,
    );
    deps.logger.log("critical", "manual_lock_engaged_by_pricing", {
      billable: p.billable, type: p.type, category: p.category,
    });
  }
  try {
    await deps.repo.updateOutboundPricing(
      ev.id,
      { billable: p.billable, type: p.type, category: p.category },
      now,
    );
  } catch {
    deps.logger.log("error", "pricing_log_failed");
  }
}
