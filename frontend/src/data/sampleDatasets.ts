import { DFGGraph, SampleDataset } from '../types/processMining';

interface ProcessStageSpec {
  activities: string[];
}

function buildRealisticProcessDfg(opts: {
  id: string;
  name: string;
  stages: ProcessStageSpec[];
  targetEdges: number;
  baseVolume: number;
  seedInit: number;
  startCount?: number;
  endCount?: number;
}): DFGGraph {
  const actList: Array<{ label: string; stageIdx: number }> = [];
  opts.stages.forEach((stage, sIdx) => {
    stage.activities.forEach((label) => {
      actList.push({ label, stageIdx: sIdx });
    });
  });

  const n = actList.length;
  let seed = opts.seedInit;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 16;
  };

  const activities: DFGGraph['activities'] = actList.map((item, i) => {
    const progress = item.stageIdx / Math.max(opts.stages.length - 1, 1);
    const attrition = 1 - progress * 0.35;
    const isPrimary = i === 0 || (i > 0 && actList[i - 1].stageIdx !== item.stageIdx);
    const variance = isPrimary ? 1.0 : 0.45 + ((nextRand() % 55) / 100);
    return {
      id: `n_${i}`,
      label: item.label,
      count: Math.max(35, Math.round(opts.baseVolume * attrition * variance)),
      meanDurationSec: 180 + ((nextRand() % 240) * 60),
    };
  });

  const edges: DFGGraph['edges'] = [];
  const usedPairs = new Set<string>();
  const addEdge = (u: number, v: number, count: number) => {
    const key = `${u}->${v}`;
    if (usedPairs.has(key)) return false;
    usedPairs.add(key);
    edges.push({
      id: `e_${edges.length}`,
      source: `n_${u}`,
      target: `n_${v}`,
      count: Math.max(5, Math.round(count)),
      meanDurationSec: 120 + ((nextRand() % 180) * 45),
    });
    return true;
  };

  // Group node indices by lifecycle stage
  const stageBuckets: number[][] = opts.stages.map(() => []);
  actList.forEach((item, i) => stageBuckets[item.stageIdx].push(i));

  // 1. Primary happy-path backbone through stage leaders
  for (let s = 0; s < stageBuckets.length - 1; s++) {
    const u = stageBuckets[s][0];
    const v = stageBuckets[s + 1][0];
    const backboneVol = opts.baseVolume * (0.85 - s * 0.04);
    addEdge(u, v, backboneVol);
  }

  // 2. Connect every non-leader activity into & out of its stage neighbors so no isolated nodes exist
  for (let s = 0; s < stageBuckets.length; s++) {
    const cur = stageBuckets[s];
    for (let j = 1; j < cur.length; j++) {
      const nodeIdx = cur[j];
      if (s > 0) {
        const prev = stageBuckets[s - 1];
        addEdge(prev[j % prev.length], nodeIdx, opts.baseVolume * (0.28 + (nextRand() % 22) / 100));
      } else {
        addEdge(cur[0], nodeIdx, opts.baseVolume * 0.25);
      }
      if (s < stageBuckets.length - 1) {
        const nxt = stageBuckets[s + 1];
        addEdge(nodeIdx, nxt[j % nxt.length], opts.baseVolume * (0.24 + (nextRand() % 20) / 100));
      }
    }
  }

  // 3. Stage-ordered realistic candidate transitions:
  //    Tier A: forward stage +1 (handoffs between consecutive lifecycle phases)
  //    Tier B: same-stage parallel/handoff steps & 1-stage rework loops (back-edges)
  //    Tier C: 2-stage fast-track skips & deeper exception rework
  const tierA: Array<[number, number]> = [];
  const tierB: Array<[number, number]> = [];
  const tierC: Array<[number, number]> = [];
  const tierD: Array<[number, number]> = [];

  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      if (u === v || usedPairs.has(`${u}->${v}`)) continue;
      const ds = actList[v].stageIdx - actList[u].stageIdx;
      if (ds === 1) tierA.push([u, v]);
      else if (ds === 0 || ds === -1) tierB.push([u, v]);
      else if (ds === 2 || ds === -2) tierC.push([u, v]);
      else tierD.push([u, v]);
    }
  }

  const shuffle = <T,>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextRand() % (i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  };
  shuffle(tierA);
  shuffle(tierB);
  shuffle(tierC);
  shuffle(tierD);

  const appendTier = (list: Array<[number, number]>, minPct: number, maxPct: number) => {
    for (let i = 0; i < list.length && edges.length < opts.targetEdges; i++) {
      const [u, v] = list[i];
      const pct = minPct + ((nextRand() % Math.max(1, Math.round((maxPct - minPct) * 100))) / 100);
      addEdge(u, v, opts.baseVolume * pct);
    }
  };

  appendTier(tierA, 0.08, 0.34);
  appendTier(tierB, 0.03, 0.18);
  appendTier(tierC, 0.015, 0.08);
  appendTier(tierD, 0.005, 0.03);

  const startActivities: Record<string, number> = {};
  const firstStage = stageBuckets[0];
  const sLimit = Math.min(opts.startCount ?? 2, firstStage.length);
  for (let i = 0; i < sLimit; i++) {
    startActivities[`n_${firstStage[i]}`] =
      i === 0 ? Math.round(opts.baseVolume * 0.85) : Math.round(opts.baseVolume * 0.15);
  }

  const endActivities: Record<string, number> = {};
  const lastStage = stageBuckets[stageBuckets.length - 1];
  const eLimit = Math.min(opts.endCount ?? 2, lastStage.length);
  for (let i = 0; i < eLimit; i++) {
    endActivities[`n_${lastStage[i]}`] =
      i === 0 ? Math.round(opts.baseVolume * 0.78) : Math.round(opts.baseVolume * 0.14);
  }

  return {
    kind: 'dfg',
    id: opts.id,
    name: opts.name,
    activities,
    startActivities,
    endActivities,
    edges,
  };
}

const PLANAR_APPROVAL_DFG: DFGGraph = {
  kind: 'dfg',
  id: 'example-planar-8-9',
  name: 'Procurement Approval (8N / 9E)',
  activities: [
    { id: 'p0', label: 'Submit Requisition', count: 500, meanDurationSec: 120 },
    { id: 'p1', label: 'Budget Screening', count: 500, meanDurationSec: 600 },
    { id: 'p2', label: 'Auto-Approve PO', count: 310, meanDurationSec: 180 },
    { id: 'p3', label: 'Director Signoff', count: 190, meanDurationSec: 5400 },
    { id: 'p4', label: 'Vendor Confirmation', count: 440, meanDurationSec: 3200 },
    { id: 'p5', label: 'Issue Purchase Order', count: 440, meanDurationSec: 420 },
    { id: 'p6', label: 'Reject & Notify', count: 60, meanDurationSec: 180 },
    { id: 'p7', label: 'Close Request', count: 500, meanDurationSec: 90 },
  ],
  startActivities: { p0: 500 },
  endActivities: { p7: 500 },
  edges: [
    { id: 'pe1', source: 'p0', target: 'p1', count: 500 },
    { id: 'pe2', source: 'p1', target: 'p2', count: 310 },
    { id: 'pe3', source: 'p1', target: 'p3', count: 190 },
    { id: 'pe4', source: 'p2', target: 'p4', count: 310 },
    { id: 'pe5', source: 'p3', target: 'p4', count: 130 },
    { id: 'pe6', source: 'p3', target: 'p6', count: 60 },
    { id: 'pe7', source: 'p4', target: 'p5', count: 440 },
    { id: 'pe8', source: 'p5', target: 'p7', count: 440 },
    { id: 'pe9', source: 'p6', target: 'p7', count: 60 },
  ],
};

function buildSmallOrderToCashDfg(): DFGGraph {
  const rawActs: Array<[string, string, number, number]> = [
    ['a0', 'Receive Order', 1240, 240],
    ['a1', 'Validate Customer', 1220, 480],
    ['a2', 'Credit Check', 1190, 1400],
    ['a3', 'Request Prepayment', 260, 10800],
    ['a4', 'Verify Inventory', 1090, 620],
    ['a5', 'Reserve Stock', 980, 540],
    ['a6', 'Backorder Procurement', 210, 28800],
    ['a7', 'Pick & Pack', 1050, 4200],
    ['a8', 'Quality Inspection', 620, 1800],
    ['a9', 'Generate Invoice', 1060, 720],
    ['a10', 'Tax Clearance', 840, 960],
    ['a11', 'Customs Dispatch', 490, 5400],
    ['a12', 'Ship Goods', 1040, 14400],
    ['a13', 'Receive Payment', 1020, 172800],
    ['a14', 'Close Order', 1020, 300],
    ['a15', 'Cancel Order', 220, 450],
  ];

  const rawEdges: Array<[number, number, number]> = [
    [0, 1, 1220], [0, 2, 20], [1, 2, 1170], [1, 15, 50],
    [2, 3, 260], [3, 2, 210], [3, 15, 50], [2, 4, 880],
    [2, 15, 80], [4, 5, 840], [4, 6, 210], [6, 5, 170],
    [6, 15, 40], [5, 7, 940], [5, 9, 40], [7, 8, 620],
    [7, 9, 430], [8, 7, 65], [8, 9, 310], [8, 12, 245],
    [9, 10, 840], [9, 12, 220], [10, 11, 490], [10, 12, 350],
    [11, 12, 490], [12, 13, 810], [12, 9, 190], [12, 14, 40],
    [13, 14, 980], [13, 13, 35], [1, 4, 45], [4, 9, 85],
    [7, 12, 365], [9, 13, 185], [10, 13, 95], [11, 13, 70],
    [2, 5, 55], [5, 8, 45], [6, 7, 38], [8, 10, 42],
    [1, 3, 28], [4, 7, 64], [10, 14, 34], [11, 14, 29],
    [12, 15, 18],
  ];

  return {
    kind: 'dfg',
    id: 'example-small-16-45',
    name: 'Order-to-Cash Process (16N / 45E)',
    activities: rawActs.map(([id, label, count, meanDurationSec]) => ({
      id,
      label,
      count,
      meanDurationSec,
    })),
    startActivities: { a0: 1240 },
    endActivities: { a14: 1020, a15: 220 },
    edges: rawEdges.map(([u, v, count], idx) => ({
      id: `se_${idx}`,
      source: `a${u}`,
      target: `a${v}`,
      count,
      meanDurationSec: 300 + idx * 140,
    })),
  };
}

const ENTERPRISE_42_500_DFG = buildRealisticProcessDfg({
  id: 'example-enterprise-42-500',
  name: 'Enterprise Fulfillment (42N / 500E)',
  targetEdges: 500,
  baseVolume: 2400,
  seedInit: 101,
  stages: [
    { activities: ['Portal Order Intake', 'EDI Order Capture', 'Verify Contract Terms', 'Check Master Data', 'Duplicate Order Check'] },
    { activities: ['Automated Credit Check', 'Fraud Risk Score', 'Manual Credit Review', 'Request Prepayment', 'Hold Order Review', 'Approve Credit Limit'] },
    { activities: ['Allocate Warehouse Stock', 'Check Safety Buffer', 'Trigger Backorder', 'Supplier PO Dispatch', 'Receive Supplier Goods', 'Cross-Dock Transfer'] },
    { activities: ['Wave Release', 'Pick Line Items', 'Verify Serial Numbers', 'Custom Assembly', 'QA Bench Check', 'Rework Packaging'] },
    { activities: ['Print Packing Slip', 'Generate Commercial Invoice', 'Apply Tax Rules', 'Customs Clearance', 'Book Carrier Pickup', 'Load Freight'] },
    { activities: ['Dispatch Shipment', 'Track In-Transit', 'Confirm Delivery POD', 'Handle Damage Claim', 'Re-ship Replacement', 'Issue Credit Memo'] },
    { activities: ['Post AR Ledger', 'Send Payment Reminder', 'Match Bank Remittance', 'Resolve Billing Dispute', 'Write-Off Adjustment', 'Archive & Close Order', 'Cancel Order'] },
  ],
});

const HOSPITAL_58_780_DFG = buildRealisticProcessDfg({
  id: 'example-hospital-58-780',
  name: 'Hospital Patient Journey (58N / 780E)',
  targetEdges: 780,
  baseVolume: 3600,
  seedInit: 2027,
  startCount: 3,
  endCount: 3,
  stages: [
    { activities: ['ED Arrival Walk-In', 'Ambulance Handover', 'Scheduled Clinic Check-In', 'Verify Insurance Coverage', 'Assign Patient Wristband', 'Triage Vitals Screening'] },
    { activities: ['Nurse Acuity Scoring', 'Pain Assessment', 'Allergy & Med Reconciliation', 'Isolate Infectious Case', 'Assign Attending Physician', 'Initial Physical Exam'] },
    { activities: ['Order Lab Panel', 'Draw Blood Sample', 'Urinalysis Culture', 'Point-of-Care Troponin', 'Order Chest X-Ray', 'Order CT Scan', 'Order MRI Brain'] },
    { activities: ['Radiology Interpretation', 'Pathology Review', 'Cardiology Consult', 'Neurology Consult', 'Surgical Evaluation', 'Anesthesia Pre-Op Check'] },
    { activities: ['IV Fluid Therapy', 'Administer Antibiotics', 'Pain Management Protocol', 'Emergency Stabilization', 'Operating Room Transfer', 'Perform Surgical Procedure', 'Post-Op PACU Recovery'] },
    { activities: ['Admit Inpatient Ward', 'ICU Bed Allocation', 'Continuous Telemetry', 'Daily Rounds Review', 'Adjust Medication Plan', 'Physical Therapy Session', 'Nutrition Consult'] },
    { activities: ['Re-Test Lab Biomarkers', 'Repeat Imaging Check', 'Social Worker Planning', 'Home Care Coordination', 'Rehab Facility Referral', 'Pharmacist Med Counseling'] },
    { activities: ['Draft Discharge Summary', 'Prescribe Outpatient Meds', 'Schedule Follow-Up Visit', 'Finalize Clinical Coding', 'Submit Insurance Claim', 'Patient Billing Statement', 'Discharged Home', 'Transferred Out', 'Left Against Advice'] },
    { activities: ['30-Day Readmission Check', 'Outpatient Telehealth Call', 'Close Episode Record', 'Quality Registry Audit'] },
  ],
});

const BANKING_72_1150_DFG = buildRealisticProcessDfg({
  id: 'example-banking-72-1150',
  name: 'Commercial Lending Lifecycle (72N / 1150E)',
  targetEdges: 1150,
  baseVolume: 4800,
  seedInit: 9913,
  startCount: 3,
  endCount: 3,
  stages: [
    { activities: ['Broker Portal Submission', 'Branch Loan Application', 'Direct Digital Intake', 'Parse Application PDF', 'Verify Applicant Identity', 'Collect Corporate Registry', 'Assign Relationship Manager'] },
    { activities: ['Sanctions Screening', 'PEP Watchlist Check', 'AML Transaction Review', 'Beneficial Owner Lookup', 'Tax Residency Verification', 'Request Missing KYC Docs', 'Compliance Escalation', 'Clear KYC Gate'] },
    { activities: ['Pull Corporate Credit Bureau', 'Verify Financial Statements', 'Normalize Cash Flow Model', 'Debt Service Ratio Calc', 'Industry Risk Benchmark', 'Verify Existing Liens', 'Guarantor Credit Check', 'ESG Risk Assessment'] },
    { activities: ['Order Property Appraisal', 'Site Inspection Visit', 'Environmental Risk Check', 'Collateral Haircut Calc', 'Verify Hazard Insurance', 'Legal Title Search', 'Perfect Collateral Lien'] },
    { activities: ['Automated Scoring Engine', 'Junior Underwriter Review', 'Senior Risk Officer Audit', 'Structure Covenant Terms', 'Pricing & Margin Approval', 'Credit Committee Vote', 'Request Additional Security', 'Counter-Offer Terms', 'Syndication Desk Check'] },
    { activities: ['Draft Facility Agreement', 'External Counsel Review', 'Borrower Redline Negotiation', 'Finalize Guarantee Deeds', 'Notarize Security Docs', 'Validate Signatures', 'Book Collateral Record'] },
    { activities: ['Conditions Precedent Check', 'Treasury Liquidity Allocation', 'Setup Loan Account', 'Configure Repayment Schedule', 'Setup Direct Debit Mandate', 'Approve First Drawdown', 'Execute Wire Disbursement', 'Confirm Escrow Settlement'] },
    { activities: ['Monthly Billing Run', 'Monitor Financial Covenants', 'Process Rate Reset', 'Handle Early Prepayment', 'Flag Late Delinquency', 'Issue Cure Notice', 'Restructure Payment Plan', 'Escalate Workout Team', 'Collections Agency Handoff'] },
    { activities: ['Internal Audit Sampling', 'Regulatory Capital Report', 'Annual Facility Renewal', 'Board Risk Signoff', 'Release Collateral Lien', 'Issue Payoff Letter', 'Close Loan Settled', 'Decline & Archive', 'Withdrawn by Applicant'] },
  ],
});

export const EXAMPLE_DATASETS: SampleDataset[] = [
  {
    id: 'ex-planar-small',
    name: 'Procurement Approval (8N / 9E)',
    profileTag: '8 nodes · 9 edges · Planar',
    description: 'Clean procurement approval flow with a single director signoff branch.',
    tracesCount: 500,
    eventsCount: 3180,
    traces: [
      {
        caseId: 'P-1',
        events: [
          { activity: 'Submit Requisition', timestamp: '2026-03-01T08:00:00Z' },
          { activity: 'Budget Screening', timestamp: '2026-03-01T08:15:00Z' },
          { activity: 'Auto-Approve PO', timestamp: '2026-03-01T08:30:00Z' },
          { activity: 'Vendor Confirmation', timestamp: '2026-03-01T10:00:00Z' },
          { activity: 'Issue Purchase Order', timestamp: '2026-03-01T10:20:00Z' },
          { activity: 'Close Request', timestamp: '2026-03-01T10:30:00Z' },
        ],
      },
    ],
    graphs: { dfg: PLANAR_APPROVAL_DFG },
  },
  {
    id: 'ex-small-16-45',
    name: 'Order-to-Cash (16N / 45E)',
    profileTag: '16 nodes · 45 edges · Cyclic DFG',
    description: 'Order-to-Cash process with credit prepayment, backorder, and QA inspection loops.',
    tracesCount: 1240,
    eventsCount: 8900,
    traces: [
      {
        caseId: 'O2C-1',
        events: [
          { activity: 'Receive Order', timestamp: '2026-03-01T08:00:00Z' },
          { activity: 'Validate Customer', timestamp: '2026-03-01T08:10:00Z' },
          { activity: 'Credit Check', timestamp: '2026-03-01T08:40:00Z' },
          { activity: 'Verify Inventory', timestamp: '2026-03-01T09:00:00Z' },
          { activity: 'Reserve Stock', timestamp: '2026-03-01T09:15:00Z' },
          { activity: 'Pick & Pack', timestamp: '2026-03-01T11:00:00Z' },
          { activity: 'Generate Invoice', timestamp: '2026-03-01T11:30:00Z' },
          { activity: 'Ship Goods', timestamp: '2026-03-01T15:00:00Z' },
          { activity: 'Receive Payment', timestamp: '2026-03-03T10:00:00Z' },
          { activity: 'Close Order', timestamp: '2026-03-03T10:15:00Z' },
        ],
      },
    ],
    graphs: { dfg: buildSmallOrderToCashDfg() },
  },
  {
    id: 'ex-enterprise-42-500',
    name: 'Enterprise Fulfillment (42N / 500E)',
    profileTag: '42 nodes · 500 edges · Dense DFG',
    description: '7-stage enterprise fulfillment lifecycle from EDI intake and credit checks through settlement.',
    tracesCount: 2400,
    eventsCount: 24800,
    traces: [],
    graphs: { dfg: ENTERPRISE_42_500_DFG },
  },
  {
    id: 'ex-hospital-58-780',
    name: 'Hospital Patient Journey (58N / 780E)',
    profileTag: '58 nodes · 780 edges · Large Clinical DFG',
    description: '9-stage hospital episode process spanning ED triage, diagnostics, OR surgery, ward care, and discharge.',
    tracesCount: 3600,
    eventsCount: 38200,
    traces: [],
    graphs: { dfg: HOSPITAL_58_780_DFG },
  },
  {
    id: 'ex-banking-72-1150',
    name: 'Commercial Lending (72N / 1150E)',
    profileTag: '72 nodes · 1,150 edges · Enterprise DFG',
    description: 'End-to-end commercial banking loan lifecycle: KYC/AML, underwriting, collateral, legal, drawdown, and servicing.',
    tracesCount: 4800,
    eventsCount: 54000,
    traces: [],
    graphs: { dfg: BANKING_72_1150_DFG },
  },
];

export const SAMPLE_DATASETS = EXAMPLE_DATASETS;
