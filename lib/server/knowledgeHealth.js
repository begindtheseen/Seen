// What THIS deployed function can read from the data files that ship beside the code.
//
// The knowledge data (lib/occupations/data, lib/text/data) reaches a Vercel function only through `includeFiles` in
// vercel.json and is read from the working directory at run time; the place data (lib/geo/data) is traced from its
// import. No local test can prove either on a real deployment, and a missing file is silent by design (the modules
// answer "no knowledge" and the tools get quietly worse). So one read answers it: GET /api/optimizer?health=1.
// It touches no database, spends nothing, and says only true / false — each check is a real lookup, not a file test.
import { ENGINE_VERSION } from '../optimizer/types.js';
import { hasOccupationData, occupationOf, militaryOccupation } from '../occupations/index.js';
import { familiesOf } from '../text/workFamilies.js';
import { synonymsOf } from '../text/synonyms.js';
import { placeSearch } from '../geo/radius.js';
import { hasActivityData, relateActivities } from '../occupations/activities.js';
import { hasTradeTalk, sameThing } from '../text/tradeTalk.js';

const safe = (fn) => { try { return !!fn(); } catch { return false; } };

export function knowledgeHealth() {
  const checks = {
    occupations: safe(() => hasOccupationData() && occupationOf('Registered Nurse')?.code === '29-1141.00'),
    military: safe(() => militaryOccupation('11B Infantryman')?.moc === '11B'),
    work_families: safe(() => familiesOf('manage inventory').some((u) => (u.families || []).length > 0)),
    synonyms: safe(() => synonymsOf('purchase', 'v').includes('buy')),
    trade_talk: safe(() => hasTradeTalk() && sameThing('vitals', 'vital signs', { field: 'healthcare' }).same === true),
    activities: safe(() => hasActivityData() && relateActivities('Drew blood from patients', 'Collect blood specimens')?.relation === 'same'),
    places: safe(() => placeSearch('Phoenix, AZ').kind === 'point'),
    zip_codes: safe(() => placeSearch('85004').state === 'AZ'),
  };
  return { ok: Object.values(checks).every(Boolean), engine_version: ENGINE_VERSION, checks };
}
