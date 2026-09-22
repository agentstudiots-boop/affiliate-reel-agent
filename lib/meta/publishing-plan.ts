import { z } from "zod";
export const reelPublicationSchema=z.object({
  jobId:z.string().uuid(),contentId:z.string().min(1),instagramUserId:z.string().regex(/^\d+$/),
  videoUrl:z.string().url().refine(value=>{const u=new URL(value);return u.protocol==="https:" && !u.username && !u.password;}),
  assetSha256:z.string().regex(/^[a-f0-9]{64}$/),caption:z.string().min(1).max(2200),
});
export type ReelPublicationState="awaiting_approval"|"creating_container"|"processing"|"ready_to_publish"|"publishing"|"published"|"unknown"|"failed";
// Pure preparation only. There is intentionally no Graph POST transport or publishing route.
export function prepareReelPublication(input:unknown){
  const payload=reelPublicationSchema.parse(input);
  return {payload,state:"awaiting_approval" as ReelPublicationState,publishingEnabled:false,approvalRequired:true,
    steps:["Freigabe für genau diesen Inhalt und Asset-Hash in Postgres speichern","Idempotenten Publishing-Job beanspruchen",
      "REELS-Container anlegen und Container-ID sofort speichern","Status bis FINISHED mit begrenztem Polling prüfen",
      "Freigabe erneut prüfen und media_publish genau einmal aufrufen","Media-ID, Permalink, Kosten und Ergebnis speichern"],
    recovery:"Bei unklarer Publish-Antwort Status unknown speichern und abgleichen; nicht automatisch erneut posten."};
}
