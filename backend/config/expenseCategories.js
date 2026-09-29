// Categories a driver can file a business expense under (routes/expenses.js).
// Keys are stored on each expense - add new ones freely, but don't rename or
// remove a key that's already in use or old expenses lose their label.
const EXPENSE_CATEGORIES = [
  { key: 'tyres', label: 'Tyres' },
  { key: 'ruc', label: 'Road User Charges (RUC)' },
  { key: 'cof', label: 'Certificate of Fitness (CoF)' },
  { key: 'service', label: 'Service & repairs' },
  { key: 'charging', label: 'EV charging' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'wash', label: 'Car wash & valet' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'registration', label: 'Registration (rego)' },
  { key: 'licensing', label: 'Licences & P endorsement' },
  { key: 'parking', label: 'Parking & tolls' },
  { key: 'phone', label: 'Phone & data' },
  { key: 'platform', label: 'Platform & booking fees' },
  { key: 'supplies', label: 'Cleaning & passenger supplies' },
  { key: 'accounting', label: 'Accounting & bank fees' },
  { key: 'other', label: 'Other' },
];

const isValidExpenseCategory = (key) => EXPENSE_CATEGORIES.some((c) => c.key === key);

module.exports = { EXPENSE_CATEGORIES, isValidExpenseCategory };
