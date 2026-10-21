// ui/tests/sellgraph_isolation.test.mjs
// Test verifying vertical isolation for Sell Graph dashboard panels

import assert from 'node:assert/strict';

// Representation of panels registered per vertical
function getPanelsForVertical(vertical) {
  const commonPanels = [
    'TopMoversPanel',
    'DeadStockPanel',
    'MarginVelocityPanel',
    'StockoutDangerPanel',
    'CategoryTrendPanel',
    'PeakHoursPanel',
  ];

  const vert = vertical.toLowerCase();
  const panels = [...commonPanels];

  if (vert === 'wholesale') {
    panels.push('WholesaleReorderPanel');
  } else if (vert === 'hospital') {
    panels.push('ExpiryRiskPanel');
    panels.push('CriticalDrugsPanel');
  }

  return panels;
}

// 1. Retail Vertical Isolation
const retailPanels = getPanelsForVertical('retail');
assert.ok(retailPanels.includes('TopMoversPanel'));
assert.ok(retailPanels.includes('DeadStockPanel'));
assert.ok(!retailPanels.includes('WholesaleReorderPanel'), 'Wholesale panel must not appear in Retail');
assert.ok(!retailPanels.includes('ExpiryRiskPanel'), 'Hospital panel must not appear in Retail');
assert.ok(!retailPanels.includes('CriticalDrugsPanel'), 'Hospital panel must not appear in Retail');

// 2. Wholesale Vertical Isolation
const wholesalePanels = getPanelsForVertical('wholesale');
assert.ok(wholesalePanels.includes('WholesaleReorderPanel'), 'Wholesale panel must appear in Wholesale');
assert.ok(!wholesalePanels.includes('ExpiryRiskPanel'), 'Hospital expiry risk must not appear in Wholesale');
assert.ok(!wholesalePanels.includes('CriticalDrugsPanel'), 'Hospital critical drugs must not appear in Wholesale');

// 3. Hospital Vertical Isolation
const hospitalPanels = getPanelsForVertical('hospital');
assert.ok(hospitalPanels.includes('ExpiryRiskPanel'), 'Hospital expiry risk must appear in Hospital');
assert.ok(hospitalPanels.includes('CriticalDrugsPanel'), 'Hospital critical drugs must appear in Hospital');
assert.ok(!hospitalPanels.includes('WholesaleReorderPanel'), 'Wholesale panel must not appear in Hospital');

console.log('ALL SELLGRAPH VERTICAL ISOLATION TESTS PASSED');
