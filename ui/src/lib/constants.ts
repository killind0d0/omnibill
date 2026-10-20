export const INDIAN_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export const GST_RATES_BPS = [
  { label: '0% (Exempt / Nil)', bps: 0 },
  { label: '5% (Essential)', bps: 500 },
  { label: '12% (Standard Low)', bps: 1200 },
  { label: '18% (Standard High)', bps: 1800 },
  { label: '28% (Luxury / Sin)', bps: 2800 },
];

export function getStateName(stateCode: string): string {
  const code = stateCode.padStart(2, '0');
  return INDIAN_STATES[code] || `State (${code})`;
}

export function isValidGstin(gstin: string): boolean {
  if (!gstin) return false;
  // 15 chars: 2 digits state + 5 alpha PAN + 4 num + 1 alpha + 1 entity char + 'Z' + 1 check char
  const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return regex.test(gstin.toUpperCase());
}
