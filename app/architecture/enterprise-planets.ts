import type { DepartmentView, EnterpriseView } from "@/lib/architecture/enterprise";
import { HEALTH_LABEL } from "./enterprise-panel";

// Enterprise level of the 3D scene (task H-03): positions and appearance of the department planets, derived only from the
// `enterprise` contract (H-01). Pure functions, so they are tested without WebGL. Executive is the centre (it plans and
// asks for decisions), the other departments of the register sit on one orbit. Size and position are fixed – they never
// suggest activity; state is shown in words and colour (colour is never the only signal), a module without runtime code
// is drawn as wireframe, and open decision requests get a ring with their count.

export type Vec3 = [number, number, number];
export type DepartmentId = DepartmentView["id"];
export type Planet = {
  id: DepartmentId;
  label: string;
  position: Vec3;
  radius: number;
  color: string;
  wireframe: boolean;
  status: string;            // state in words, e.g. "In Ordnung", "nicht angeschlossen", "Bericht nicht lesbar"
  pendingDecisions: number | null;
  sub: string;               // second label line
  plain: string;             // tooltip
};

export const PLANET_ORBIT = 11;
const CENTRE: DepartmentId = "executive";
const NO_MODULE = { label: "nicht angeschlossen", color: "#5b6676" };
const UNREADABLE = { label: "Bericht nicht lesbar", color: "#8892a0" };

function state(department: DepartmentView) {
  if (department.module === "none") return NO_MODULE;
  if (!department.health) return UNREADABLE;
  return HEALTH_LABEL[department.health.status];
}

export function planetPositions(ids: readonly DepartmentId[]): Record<string, Vec3> {
  const ring = ids.filter(id => id !== CENTRE);
  const positions: Record<string, Vec3> = {};
  if (ids.includes(CENTRE)) positions[CENTRE] = [0, 0, 0];
  ring.forEach((id, index) => {
    // First planet in front of the camera, the others clockwise.
    const angle = Math.PI / 2 + (index / Math.max(1, ring.length)) * Math.PI * 2;
    positions[id] = [round(Math.cos(angle) * PLANET_ORBIT), 0, round(Math.sin(angle) * PLANET_ORBIT)];
  });
  return positions;
}

export function planets(view: EnterpriseView | undefined): Planet[] {
  if (!view) return [];
  const positions = planetPositions(view.departments.map(department => department.id));
  return view.departments.map(department => {
    const { label: status, color } = state(department);
    const pending = department.decisions ? department.decisions.pending : null;
    // Unreadable decisions are said in words: a planet without a ring must not look like "no open decision".
    const open = pending === null ? " · Entscheidungen: keine Daten" : pending ? ` · ${pending} ${pending === 1 ? "Entscheidung" : "Entscheidungen"} offen` : "";
    const plain = department.module === "none"
      ? `${department.label}: ${department.runtime ? "Laufzeitmodul noch nicht gebaut" : "arbeitet außerhalb der App"}. Klicken für Details.`
      : `${department.label}: ${status}${department.health?.reason ? ` – ${department.health.reason}` : ""}. Klicken für Details.`;
    const decisionsText = pending === null ? " Entscheidungsvorlagen: keine Daten." : "";
    return {
      id: department.id, label: department.label, position: positions[department.id], radius: department.id === CENTRE ? 2.1 : 1.45,
      color, wireframe: department.module === "none", status, pendingDecisions: pending, sub: `${status}${open}`, plain: plain + decisionsText,
    };
  });
}

// Camera: the whole orbit in view (seen steeply from above, so planets in front and behind look alike), or one planet from
// outside with its neighbours still in view (the centre is shown with the overview).
export function enterpriseOverviewGoal(aspect: number, fov = 45): { position: Vec3; target: Vec3 } {
  const distance = overviewDistance(aspect, fov);
  return { position: [0, round(distance * 0.78), round(distance * 0.63 + 1)], target: [0, 0, 1] };
}
export function planetGoal(position: Vec3, aspect: number): { position: Vec3; target: Vec3 } {
  const length = Math.hypot(position[0], position[2]);
  const away = aspect < 1 ? 22 : 17;
  const [dx, dz] = length ? [position[0] / length, position[2] / length] : [0, 1];
  return { position: [round(position[0] + dx * away), round(away * 0.8), round(position[2] + dz * away)], target: position };
}
// Label size: the planet title about 14 px tall in the overview, whatever the stage size (same rule as layout.labelSizing).
export function planetLabelScale(aspect: number, heightPx: number, fov = 45) {
  return Math.min(2, Math.max(0.8, (14 * overviewDistance(aspect, fov)) / (0.79 * 0.8 * Math.max(200, heightPx))));
}
function overviewDistance(aspect: number, fov: number) {
  const halfHorizontal = Math.tan((fov * Math.PI) / 360) * Math.max(0.35, aspect);
  return Math.max(26, Math.min(80, (PLANET_ORBIT + 7) / halfHorizontal));
}

function round(value: number) { return Math.round(value * 1000) / 1000; }
