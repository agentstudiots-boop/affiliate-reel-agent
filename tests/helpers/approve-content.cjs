const { contentFingerprint } = require('../../.test-build/lib/whatsapp/content-approval');

// Fixture for an already received, explicitly bound WhatsApp content approval.
async function approveContent(db, memory, id) {
  const job = await memory.approve(id);
  const approvalId=crypto.randomUUID();
  await db.query("INSERT INTO content_approval_requests(id,job_id,content_hash,status,approver_wa_id,whatsapp_message_id,decided_at) VALUES($1,$2,$3,'approved','491234',$4,now())",[approvalId,id,contentFingerprint(job),`fixture-${approvalId}`]);
  return job;
}
module.exports = { approveContent };
