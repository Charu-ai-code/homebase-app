// Mock household state for the HomeBase prototype.
// Everything here is in-memory: reload the page and it resets to this seed.
// "Today" is pinned to Thursday 27 August so the dashboard, calendar, meal
// plan and shopping list all agree with each other and with the wireframes.

const PEOPLE = {
  charu: { key: 'charu', name: 'Charu', color: '#ec3013', calorieTarget: 1650 },
  shreya: { key: 'shreya', name: 'Shreya', color: '#201e1d', calorieTarget: 2000 },
};
const PROTEIN_FLOOR = 110; // grams, shared floor for both people

const WHOOP = {
  charu: { recovery: 42, sleep: '6h 12m', strain: 8.4 },
  shreya: { recovery: 81, sleep: '7h 48m', strain: 14.2 },
};

const TODAY_INDEX = 3; // Thursday 27 August, within WEEK below

const WEEK = [
  {
    key: 'mon', label: 'MON', date: 24, full: 'Monday 24 August',
    who: { charu: 'Studio 10–4', shreya: 'Office · gym 6 AM' },
    events: [
      { start: '08:00', end: '09:00', title: 'Gym', person: 'shreya' },
      { start: '10:00', end: '16:00', title: 'Studio 10–4', person: 'charu', highlight: true },
      { start: '20:30', end: '21:00', title: 'Prep · soak', person: 'charu' },
    ],
    dinner: { name: 'Rajma Chawal', time: '7:15 PM', minutes: 45, method: 'cooker' },
    prep: { who: 'charu', task: 'Soak rajma', when: 'Sun 9:30 PM', minutes: 2, forTomorrow: false },
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Vegetable poha', kcal: 320, protein: 9 },
      shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
      lunch: { name: 'Dal + brown rice + salad', kcal: 480, protein: 22 },
      snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
      dinner: { name: 'Rajma Chawal', kcal: 520, protein: 24 },
    },
  },
  {
    key: 'tue', label: 'TUE', date: 25, full: 'Tuesday 25 August',
    who: { charu: 'Illustration deadline', shreya: 'Office · late 7 PM' },
    events: [
      { start: '09:00', end: '15:00', title: 'Illustration deadline', person: 'charu', highlight: true },
      { start: '17:00', end: '19:00', title: 'Office · late', person: 'shreya' },
      { start: '21:00', end: '21:15', title: 'Prep · thaw', person: 'shreya' },
    ],
    dinner: { name: 'Shawarma Bowls', time: '7:15 PM', minutes: 30, method: 'sheet pan' },
    prep: { who: 'shreya', task: 'Thaw chicken', when: 'Mon 9:00 PM', minutes: 1, forTomorrow: false },
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Greek yogurt + granola', kcal: 300, protein: 18 },
      shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
      lunch: { name: 'Leftover shawarma bowl', kcal: 450, protein: 32 },
      snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
      dinner: { name: 'Shawarma Bowls', kcal: 480, protein: 34 },
    },
  },
  {
    key: 'wed', label: 'WED', date: 26, full: 'Wednesday 26 August',
    who: { charu: 'Home all day', shreya: 'Client site' },
    events: [
      { start: '08:30', end: '17:00', title: 'Home all day', person: 'charu' },
      { start: '09:00', end: '15:30', title: 'Client site', person: 'shreya' },
      { start: '20:00', end: '20:12', title: 'Prep · spinach', person: 'charu', highlight: true },
    ],
    dinner: { name: 'Palak Paneer', time: '7:15 PM', minutes: 40, method: 'stovetop' },
    prep: { who: 'charu', task: 'Blanch spinach', when: 'Tue 8:00 PM', minutes: 12, forTomorrow: false },
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Besan chilla, 2', kcal: 340, protein: 16 },
      shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
      lunch: { name: 'Quinoa + chickpea salad', kcal: 420, protein: 20 },
      snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
      dinner: { name: 'Palak Paneer', kcal: 430, protein: 22 },
    },
  },
  {
    key: 'thu', label: 'THU', date: 27, full: 'Thursday 27 August',
    who: { charu: 'Client call 2–3:45', shreya: 'Free after 4:15' },
    events: [
      { start: '08:00', end: '09:05', title: 'Gym · lower body', person: 'shreya' },
      { start: '09:00', end: '09:45', title: 'Design review', person: 'charu' },
      { start: '14:00', end: '15:45', title: 'Client call · Meridian', person: 'charu', highlight: true },
      { start: '16:30', end: '16:38', title: 'Marinate chicken', person: 'shreya', prep: true },
      { start: '18:30', end: '19:10', title: 'Yoga · restorative', person: 'charu' },
      { start: '19:15', end: '20:00', title: 'Dinner together', person: 'shared' },
      { start: '21:00', end: '21:10', title: 'Trash + recycling out', person: 'shreya' },
    ],
    dinner: { name: 'Tandoori Chicken', time: '7:15 PM', minutes: 35, method: 'oven', marinateHours: 4 },
    prep: { who: 'shreya', task: 'Marinate chicken', when: 'TODAY 4:30 PM', minutes: 8, forTomorrow: false, urgent: true },
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Egg bhurji + toast', kcal: 360, protein: 22 },
      shake: { name: 'Whey + banana shake', kcal: 200, protein: 24 },
      lunch: { name: 'Grilled paneer wrap', kcal: 460, protein: 24 },
      snack: { name: 'Roasted chana + fruit', kcal: 120, protein: 6 },
      dinner: { name: 'Tandoori Chicken', kcal: 470, protein: 42 },
    },
  },
  {
    key: 'fri', label: 'FRI', date: 28, full: 'Friday 28 August',
    who: { charu: 'Low recovery', shreya: 'Autocross prep' },
    events: [
      { start: '09:00', end: '12:00', title: 'Autocross prep', person: 'shreya' },
      { start: '20:00', end: '20:10', title: 'Start dosa batter', person: 'charu', prep: true },
      { start: '19:15', end: '19:45', title: 'Dinner together', person: 'shared' },
    ],
    dinner: { name: 'One-pot Lemon Orzo', time: '7:15 PM', minutes: 20, method: 'stovetop', swappedIn: true },
    prep: null,
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Overnight oats + peanut butter', kcal: 380, protein: 16 },
      shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
      lunch: { name: 'Sprouts + peanut salad', kcal: 400, protein: 20 },
      snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
      dinner: { name: 'One-pot Lemon Orzo', kcal: 380, protein: 14 },
    },
  },
  {
    key: 'sat', label: 'SAT', date: 29, full: 'Saturday 29 August',
    who: { charu: 'Free 10–1', shreya: 'Free 10–1' },
    events: [
      { start: '10:00', end: '13:00', title: 'Both free 10–1', person: 'shared', suggested: true },
      { start: '19:00', end: '19:30', title: 'Dosa night', person: 'shared' },
    ],
    dinner: { name: 'Dosa Night', time: '7:00 PM', minutes: 30, method: 'tawa', batterDependent: true },
    prep: { who: 'charu', task: 'Start dosa batter', when: 'Fri 8:00 PM', minutes: 10, forTomorrow: false },
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Idli (3) + sambar', kcal: 300, protein: 10 },
      shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
      lunch: { name: 'Leftover dosa + chutney', kcal: 380, protein: 12 },
      snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
      dinner: { name: 'Dosa Night', kcal: 410, protein: 16 },
    },
  },
  {
    key: 'sun', label: 'SUN', date: 30, full: 'Sunday 30 August',
    who: { charu: 'Farmers market', shreya: 'Drive · Skyline' },
    events: [
      { start: '08:30', end: '10:00', title: 'Farmers market', person: 'charu' },
      { start: '10:30', end: '13:00', title: 'Skyline drive', person: 'shreya' },
      { start: '09:00', end: '09:20', title: 'Portion proteins', person: 'shreya', prep: true },
    ],
    dinner: { name: 'Slow-cooker Chili', time: '7:00 PM', minutes: 15, method: '6 hr low' },
    prep: { who: 'shreya', task: 'Portion proteins', when: 'Sun 9:00 AM', minutes: 20, forTomorrow: false },
    meals: {
      drink: { name: 'Jeera water', kcal: 15, protein: 0 },
      breakfast: { name: 'Masala omelette + paratha', kcal: 420, protein: 20 },
      shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
      lunch: { name: 'Rajma + rice, small', kcal: 470, protein: 18 },
      snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
      dinner: { name: 'Slow-cooker Chili', kcal: 460, protein: 32 },
    },
  },
];

function dayTotals(day) {
  const slots = ['drink', 'breakfast', 'shake', 'lunch', 'snack', 'dinner'];
  let kcal = 0, protein = 0;
  slots.forEach((s) => { kcal += day.meals[s].kcal; protein += day.meals[s].protein; });
  return { kcal, protein };
}

const HOUSEHOLD_TASKS = [
  { id: 'laundry', title: 'Laundry · darks', person: 'charu', due: 'THU', tag: 'laundry', done: false },
  { id: 'trash', title: 'Trash + recycling out', person: 'shreya', due: 'THU', tag: 'cleaning', done: false, note: 'tonight' },
  { id: 'deepclean', title: 'Deep clean · 2 hr', person: 'shared', due: 'SAT', tag: 'cleaning', done: false, suggested: true, suggestedTime: '10:00' },
  { id: 'costco', title: 'Costco run', person: 'shared', due: 'SAT', tag: 'errands', done: false, suggested: true, suggestedTime: '12:00' },
  { id: 'oil', title: 'Oil change · GR86', person: 'shreya', due: null, tag: 'car', done: false, note: '340 mi' },
  { id: 'internet', title: 'Internet bill', person: 'shared', due: 'FRI', tag: 'bills', done: true, note: 'auto' },
  { id: 'lens', title: 'Return the lens', person: 'charu', due: 'MON', tag: 'errands', done: false },
];

const SHOPPING_LIST = [
  {
    aisle: 'Produce', items: [
      { id: 'onions', name: 'Onions', qty: '5', note: '4 recipes · merged from 22 lines', checked: false, merged: true },
      { id: 'tomatoes', name: 'Roma tomatoes', qty: '6', note: 'Kachumber · Shawarma', checked: false },
      { id: 'spinach', name: 'Baby spinach', qty: '400 g', note: 'Palak Paneer', checked: true },
      { id: 'cilantro', name: 'Cilantro', qty: '2 bunches', note: '3 recipes · merged', checked: false },
      { id: 'lemons', name: 'Lemons', qty: '4', note: 'Tandoori · Orzo', checked: false },
      { id: 'cucumbers', name: 'Persian cucumbers', qty: '5', note: 'Kachumber', checked: false },
    ],
  },
  {
    aisle: 'Meat + dairy', items: [
      { id: 'chicken', name: 'Chicken thighs, bone-in', qty: '3 lb', note: 'Tandoori · Shawarma', checked: false },
      { id: 'yogurt', name: 'Whole-milk yogurt', qty: '32 oz', note: 'Tandoori marinade', checked: false },
      { id: 'paneer', name: 'Paneer', qty: '400 g', note: 'Palak Paneer', checked: false },
      { id: 'milk', name: 'Milk', qty: '1 gal', note: 'Added by Shreya · 2h ago', checked: false, merged: true },
    ],
  },
  {
    aisle: 'Pantry', items: [
      { id: 'rajma', name: 'Rajma, dry', qty: '1 lb', note: 'Rajma Chawal', checked: false },
      { id: 'peanuts', name: 'Peanuts', qty: '200 g', note: 'Sprouts salad', checked: false },
      { id: 'rava', name: 'Semolina (rava)', qty: '500 g', note: 'Extra idli batter', checked: false },
    ],
  },
  {
    aisle: 'Frozen', items: [
      { id: 'peas', name: 'Green peas', qty: '1 bag', note: 'Palak Paneer + pulao', checked: false },
    ],
  },
];

const ALREADY_AT_HOME = ['Basmati', 'Ginger', 'Garam masala', 'Turmeric', 'Cumin seed', 'Ghee', 'Green chilies', 'Chana dal', 'Mustard oil'];

const ONION_BREAKDOWN = [
  { recipe: 'Rajma Chawal', qty: '1 large' },
  { recipe: 'Shawarma Bowls', qty: '2 medium' },
  { recipe: 'Palak Paneer', qty: '1 medium' },
  { recipe: 'Kachumber', qty: '1 small' },
];

const SKIP_DINNER_MESSAGES = [
  'Dropping Wednesday’s Palak Paneer removes paneer, spinach and cream, and takes onions from 5 down to 4.',
  'Dropping Thursday’s Tandoori Chicken removes chicken and yogurt marinade, and takes lemons from 4 down to 2.',
  'Dropping Monday’s Rajma Chawal removes the rajma entirely, and takes onions from 5 down to 4.',
];
