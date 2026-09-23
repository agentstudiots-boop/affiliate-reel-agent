import { ImageResponse } from "next/og";
import { put } from "@vercel/blob";
import { getDatabase } from "@/lib/memory/db";
import { parseJob } from "@/lib/content/history";

// Original typographic card: no borrowed product photo or unverified model claim.
export async function createSocialCard(jobId: string) {
  const stored = await getDatabase().query("SELECT snapshot FROM content_jobs WHERE id=$1", [jobId]);
  if (!stored.rows[0]) throw new Error("Content-Job fehlt.");
  const job = parseJob(stored.rows[0].snapshot);
  if (job.status !== "approved" || !job.content) throw new Error("Content nicht freigegeben.");
  const title = job.opportunity.product.name.slice(0, 110);
  const hook = job.content.hook.slice(0, 135);
  const image = new ImageResponse(
    <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",width:"100%",height:"100%",padding:92,
      background:"linear-gradient(140deg,#142c27,#345240 60%,#728262)",color:"#f7f4e8",fontFamily:"sans-serif"}}>
      <div style={{display:"flex",fontSize:38,letterSpacing:3}}>ALLTÄGLICH LEICHTER</div>
      <div style={{display:"flex",flexDirection:"column",gap:38}}>
        <div style={{display:"flex",fontSize:40,color:"#e7cca6"}}>PRODUKTIDEE · VERGLEICH</div>
        <div style={{display:"flex",fontSize:89,fontWeight:700,lineHeight:1.07}}>{title}</div>
        <div style={{display:"flex",fontSize:49,lineHeight:1.2}}>{hook}</div>
      </div>
      <div style={{display:"flex",fontSize:31}}>Werbung · Affiliate-Link im Beitrag · Symbolgrafik</div>
    </div>,
    {width:1080,height:1350},
  );
  const bytes = await image.arrayBuffer();
  if (bytes.byteLength > 4_000_000) throw new Error("Grafik überschreitet das Bildlimit.");
  const blob = await put(`social-cards/${jobId}.png`, bytes, {access:"public",addRandomSuffix:false,contentType:"image/png"});
  return blob.url;
}
