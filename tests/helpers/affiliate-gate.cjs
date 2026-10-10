// Puts an affiliate image post into the state the shared distribution layer leaves it in after the operator's second
// approval and before the Instagram container is published: central approval granted, permits issued, platform attempts
// "processing". Uses the real gate and real distribution code with inert publishers (no network, no platform call).
const { publishApprovedAffiliateImage } = require('../../.test-build/lib/distribution/affiliate');
const inert = platform => ({ platform, configured: () => ({ ok: true, missing: [] }), supports: () => true,
  async publish() { return { state: 'processing', externalId: `${platform}-pending`, url: null }; } });
async function grantAffiliateImageGate(db, publicationId, trustedWaId = process.env.WHATSAPP_APPROVER_WA_ID) {
  return publishApprovedAffiliateImage(publicationId, { db, trustedWaId, publishers: ['facebook', 'instagram', 'tiktok', 'youtube', 'x'].map(inert) });
}
module.exports = { grantAffiliateImageGate, contentIdForImage: publicationId => `aff_img_${publicationId}` };
