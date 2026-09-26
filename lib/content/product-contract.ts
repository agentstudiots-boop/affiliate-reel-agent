import { productIdentityError, requireProduct } from "../amazon";
import type { ContentJob } from "./schema";
export function jobProductError(job: ContentJob) {
  return productIdentityError(job.opportunity.product, JSON.stringify(job.content || {}));
}
export function requireJobProduct(job: ContentJob) {
  requireProduct(job.opportunity.product, JSON.stringify(job.content || {}));
}
