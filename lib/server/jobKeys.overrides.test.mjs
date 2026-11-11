// Round 7: the occupation knowledge base (lib/occupations) decides a title when its answer is `exact` (a fact by
// its contract); otherwise this file's job-type table, the shared field reader, then a `close` answer. These are the
// titles where the table is right and the knowledge base is wrong, ambiguous or unknown (never `exact`): each stays a
// table OVERRIDE and is listed for the knowledge-base engineer. [title, the table's job type, what the knowledge base says]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoleTitle, moduleOccupation } from './jobKeys.js';

const OVERRIDES = [
  ["Supply Sergeant (92Y)", "inventory_specialist", "53-7065.00 close"],
  ["Unit Supply Specialist", "inventory_specialist", "43-5061.00 close"],
  ["Logistics Specialist Second Class (LS2)", "inventory_specialist", "13-1081.00 close"],
  ["Storekeeper, U.S. Coast Guard", "inventory_specialist", "43-3031.00 close"],
  ["Patient Access Representative", "medical_receptionist", "29-2099.08 close"],
  ["Laboratory Assistant", "lab_assistant", "29-2012.00 close"],
  ["Specimen Processor", "lab_assistant", "29-2012.00 close"],
  ["Unit Secretary", "medical_receptionist", "null"],
  ["Dialysis Patient Care Technician", "cna", "29-2099.00 close"],
  ["Building Engineer", "maintenance_tech", "17-2051.00 close"],
  ["3rd Grade Teacher", "instructor", "null"],
  ["Paraprofessional", "teaching_assistant", "null"],
  ["Adjunct Instructor", "instructor", "null"],
  ["Deputy Clerk of Court", "records_clerk", "43-9199.00 close"],
  ["Public Records Specialist", "records_clerk", "null"],
  ["Data Analyst Intern", "data_analyst", "15-2051.00 close"],
  ["Undergraduate Research Assistant", "research_assistant", "null"],
  ["IT Service Desk Co-op", "it_support", "null"],
  ["Marketing Intern", "marketing", "null"],
  ["Audit Intern", "accountant", "null"],
  ["Office Coordinator", "admin_assistant", "43-1011.00 close"],
  ["Docketing Specialist", "legal_assistant", "43-4031.00 close"],
  ["Workplace Experience Manager", "office_manager", "null"],
  ["Director of Front of House", "restaurant_manager", "null"],
  ["Process Assistant (PA)", "warehouse_associate", "null"],
  ["Account Executive", "account_executive", "null"],
  ["Sales Development Representative", "sdr", "41-3091.00 close"],
  ["Food Safety Coordinator", "food_safety", "19-5011.00 close"],
  ["Teller Supervisor", "bank_teller", "43-1011.00 close"],
  ["Claims Processor", "medical_billing", "43-9041.00 close"],
  ["Prior Authorization Specialist", "medical_billing", "null"],
  ["Yard Jockey", "warehouse_associate", "null"],
  ["Records Management Specialist", "records_clerk", "25-4011.00 close"],
];

test('overrides: the table places each title the knowledge base misreads or cannot place', () => {
  for (const [title, want, kb] of OVERRIDES) {
    assert.equal(classifyRoleTitle(title, '')[0]?.id, want, title);
    const m = moduleOccupation(title, {});
    assert.ok(!m || m.confidence !== 'exact', `${title}: an exact answer would win over the table`);
    assert.notEqual(m?.occ.id || null, want, `${title}: the knowledge base now agrees (${kb}) — drop the override`);
  }
});

test('the knowledge base places what the table cannot: military codes, by its trust contract', () => {
  const mot = moduleOccupation('Motor Transport Operator (88M), Squad Leader', { employer: 'U.S. Army' });
  assert.equal(mot?.occ.id, 'truck_driver_cdl');
  assert.equal(moduleOccupation('Process Assistant (PA)', {})?.occ.id ?? null, null, 'employer jargon without the employer is only a guess: never a basis');
});
