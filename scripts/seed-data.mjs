import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { neon } from '@neondatabase/serverless';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

function hashPin(pin) {
  const salt = process.env.PIN_SALT || 'homebase-dev-salt';
  return createHash('sha256').update(String(pin) + salt).digest('hex');
}

function loadSql() {
  return readFileSync(join(__dirname, '../db/migrations/0001_init.sql'), 'utf8');
}

export const SEED_WEEK_START = '2026-08-24';

export const SEED_DATA = {
  people: [
    { key: 'charu', name: 'Charu', color: '#ec3013', calorieTarget: 1650, pin: process.env.CHARU_PIN || '1234' },
    { key: 'shreya', name: 'Shreya', color: '#201e1d', calorieTarget: 2000, pin: process.env.SHREYA_PIN || '5678' },
  ],
  week: [
    {
      date: '2026-08-24', key: 'mon',
      events: [
        { start: '08:00', end: '09:00', title: 'Gym', person: 'shreya' },
        { start: '10:00', end: '16:00', title: 'Studio 10–4', person: 'charu', highlight: true },
        { start: '20:30', end: '21:00', title: 'Prep · soak', person: 'charu', prep: true },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Vegetable poha', kcal: 320, protein: 9 },
        shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
        lunch: { name: 'Dal + brown rice + salad', kcal: 480, protein: 22 },
        snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
        dinner: { name: 'Rajma Chawal', kcal: 520, protein: 24, minutes: 45, method: ['cooker'] },
      },
    },
    {
      date: '2026-08-25', key: 'tue',
      events: [
        { start: '09:00', end: '15:00', title: 'Illustration deadline', person: 'charu', highlight: true },
        { start: '17:00', end: '19:00', title: 'Office · late', person: 'shreya' },
        { start: '21:00', end: '21:15', title: 'Prep · thaw', person: 'shreya', prep: true },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Greek yogurt + granola', kcal: 300, protein: 18 },
        shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
        lunch: { name: 'Leftover shawarma bowl', kcal: 450, protein: 32 },
        snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
        dinner: { name: 'Shawarma Bowls', kcal: 480, protein: 34, minutes: 30, method: ['sheet pan'] },
      },
    },
    {
      date: '2026-08-26', key: 'wed',
      events: [
        { start: '08:30', end: '17:00', title: 'Home all day', person: 'charu' },
        { start: '09:00', end: '15:30', title: 'Client site', person: 'shreya' },
        { start: '20:00', end: '20:12', title: 'Prep · spinach', person: 'charu', prep: true, highlight: true },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Besan chilla, 2', kcal: 340, protein: 16 },
        shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
        lunch: { name: 'Quinoa + chickpea salad', kcal: 420, protein: 20 },
        snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
        dinner: { name: 'Palak Paneer', kcal: 430, protein: 22, minutes: 40, method: ['stovetop'] },
      },
    },
    {
      date: '2026-08-27', key: 'thu',
      events: [
        { start: '08:00', end: '09:05', title: 'Gym · lower body', person: 'shreya' },
        { start: '09:00', end: '09:45', title: 'Design review', person: 'charu' },
        { start: '14:00', end: '15:45', title: 'Client call · Meridian', person: 'charu', highlight: true },
        { start: '16:30', end: '16:38', title: 'Marinate chicken', person: 'shreya', prep: true },
        { start: '18:30', end: '19:10', title: 'Yoga · restorative', person: 'charu' },
        { start: '19:15', end: '20:00', title: 'Dinner together', person: 'shared' },
        { start: '21:00', end: '21:10', title: 'Trash + recycling out', person: 'shreya' },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Egg bhurji + toast', kcal: 360, protein: 22 },
        shake: { name: 'Whey + banana shake', kcal: 200, protein: 24 },
        lunch: { name: 'Grilled paneer wrap', kcal: 460, protein: 24 },
        snack: { name: 'Roasted chana + fruit', kcal: 120, protein: 6 },
        dinner: { name: 'Tandoori Chicken', kcal: 470, protein: 42, minutes: 35, method: ['oven'] },
      },
    },
    {
      date: '2026-08-28', key: 'fri',
      events: [
        { start: '09:00', end: '12:00', title: 'Autocross prep', person: 'shreya' },
        { start: '20:00', end: '20:10', title: 'Start dosa batter', person: 'charu', prep: true },
        { start: '19:15', end: '19:45', title: 'Dinner together', person: 'shared' },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Overnight oats + peanut butter', kcal: 380, protein: 16 },
        shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
        lunch: { name: 'Sprouts + peanut salad', kcal: 400, protein: 20 },
        snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
        dinner: { name: 'One-pot Lemon Orzo', kcal: 380, protein: 14, minutes: 20, method: ['stovetop'] },
      },
    },
    {
      date: '2026-08-29', key: 'sat',
      events: [
        { start: '10:00', end: '13:00', title: 'Both free 10–1', person: 'shared', suggested: true },
        { start: '19:00', end: '19:30', title: 'Dosa night', person: 'shared' },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Idli (3) + sambar', kcal: 300, protein: 10 },
        shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
        lunch: { name: 'Leftover dosa + chutney', kcal: 380, protein: 12 },
        snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
        dinner: { name: 'Dosa Night', kcal: 410, protein: 16, minutes: 30, method: ['tawa'] },
      },
    },
    {
      date: '2026-08-30', key: 'sun',
      events: [
        { start: '08:30', end: '10:00', title: 'Farmers market', person: 'charu' },
        { start: '10:30', end: '13:00', title: 'Skyline drive', person: 'shreya' },
        { start: '09:00', end: '09:20', title: 'Portion proteins', person: 'shreya', prep: true },
      ],
      meals: {
        drink: { name: 'Jeera water', kcal: 15, protein: 0 },
        breakfast: { name: 'Masala omelette + paratha', kcal: 420, protein: 20 },
        shake: { name: 'Whey + banana shake', kcal: 210, protein: 24 },
        lunch: { name: 'Rajma + rice, small', kcal: 470, protein: 18 },
        snack: { name: 'Roasted chana + fruit', kcal: 140, protein: 7 },
        dinner: { name: 'Slow-cooker Chili', kcal: 460, protein: 32, minutes: 15, method: ['6 hr low'] },
      },
    },
  ],
  tasks: [
    { slug: 'laundry', title: 'Laundry · darks', person: 'charu', due: '2026-08-27', tag: 'laundry' },
    { slug: 'trash', title: 'Trash + recycling out', person: 'shreya', due: '2026-08-27', tag: 'cleaning', note: 'tonight' },
    { slug: 'deepclean', title: 'Deep clean · 2 hr', person: 'shared', due: '2026-08-29', tag: 'cleaning', suggested: true, suggestedTime: '10:00' },
    { slug: 'costco', title: 'Costco run', person: 'shared', due: '2026-08-29', tag: 'errands', suggested: true, suggestedTime: '12:00' },
    { slug: 'oil', title: 'Oil change · GR86', person: 'shreya', due: null, tag: 'car', note: '340 mi' },
    { slug: 'internet', title: 'Internet bill', person: 'shared', due: '2026-08-28', tag: 'bills', done: true, note: 'auto' },
    { slug: 'lens', title: 'Return the lens', person: 'charu', due: '2026-08-24', tag: 'errands' },
  ],
  shopping: [
    { aisle: 'Produce', items: [
      { name: 'Onions', qty: '5', note: '4 recipes · merged from 22 lines', merged: true },
      { name: 'Roma tomatoes', qty: '6', note: 'Kachumber · Shawarma' },
      { name: 'Baby spinach', qty: '400 g', note: 'Palak Paneer', checked: true },
      { name: 'Cilantro', qty: '2 bunches', note: '3 recipes · merged', merged: true },
      { name: 'Lemons', qty: '4', note: 'Tandoori · Orzo' },
      { name: 'Persian cucumbers', qty: '5', note: 'Kachumber' },
    ]},
    { aisle: 'Meat + dairy', items: [
      { name: 'Chicken thighs, bone-in', qty: '3 lb', note: 'Tandoori · Shawarma' },
      { name: 'Whole-milk yogurt', qty: '32 oz', note: 'Tandoori marinade' },
      { name: 'Paneer', qty: '400 g', note: 'Palak Paneer' },
      { name: 'Milk', qty: '1 gal', note: 'Added by Shreya · 2h ago', merged: true },
    ]},
    { aisle: 'Pantry', items: [
      { name: 'Rajma, dry', qty: '1 lb', note: 'Rajma Chawal' },
      { name: 'Peanuts', qty: '200 g', note: 'Sprouts salad' },
      { name: 'Semolina (rava)', qty: '500 g', note: 'Extra idli batter' },
    ]},
    { aisle: 'Frozen', items: [
      { name: 'Green peas', qty: '1 bag', note: 'Palak Paneer + pulao' },
    ]},
  ],
};

/** Extra recipes beyond the week's dinners — powers Recipe Book. */
export const COOKBOOK_RECIPES = [
  {
    name: 'Butter Chicken',
    minutes: 40,
    kcal: 520,
    protein: 36,
    servings: '3–4',
    tags: ['dinner', 'chicken'],
    method: ['Marinate chicken in yogurt + spices 30 min', 'Simmer tomato-butter gravy', 'Finish with cream and kasuri methi'],
    ingredients: [
      { name: 'Chicken thighs', qty: '1.5 lb', aisle: 'Meat + dairy' },
      { name: 'Tomato puree', qty: '1 cup', aisle: 'Pantry' },
      { name: 'Heavy cream', qty: '1/2 cup', aisle: 'Meat + dairy' },
      { name: 'Butter', qty: '3 tbsp', aisle: 'Meat + dairy' },
    ],
  },
  {
    name: 'Khichdi',
    minutes: 25,
    kcal: 380,
    protein: 14,
    servings: '2',
    tags: ['dinner', 'comfort'],
    method: ['Rinse rice + moong dal', 'Pressure cook with turmeric and ghee', 'Temper with cumin and green chili'],
    ingredients: [
      { name: 'Moong dal', qty: '1/2 cup', aisle: 'Pantry' },
      { name: 'Basmati rice', qty: '1/2 cup', aisle: 'Pantry' },
      { name: 'Ghee', qty: '2 tbsp', aisle: 'Pantry' },
    ],
  },
  {
    name: 'Poke Bowls',
    minutes: 20,
    kcal: 450,
    protein: 32,
    servings: '2',
    tags: ['lunch', 'dinner'],
    method: ['Cook sushi rice', 'Cube tuna or tofu', 'Assemble with cucumber, avocado, sesame'],
    ingredients: [
      { name: 'Sushi-grade tuna', qty: '12 oz', aisle: 'Meat + dairy' },
      { name: 'Avocado', qty: '1', aisle: 'Produce' },
      { name: 'Sushi rice', qty: '1 cup', aisle: 'Pantry' },
      { name: 'Soy sauce', qty: '3 tbsp', aisle: 'Pantry' },
    ],
  },
  {
    name: 'Kachumber',
    minutes: 10,
    kcal: 60,
    protein: 2,
    servings: '4 as side',
    tags: ['side', 'salad'],
    method: ['Dice cucumber, tomato, onion', 'Toss with lemon, salt, cilantro'],
    ingredients: [
      { name: 'Persian cucumbers', qty: '3', aisle: 'Produce' },
      { name: 'Roma tomatoes', qty: '2', aisle: 'Produce' },
      { name: 'Onion', qty: '1 small', aisle: 'Produce' },
      { name: 'Lemon', qty: '1', aisle: 'Produce' },
    ],
  },
  {
    name: 'Avocado Toast',
    minutes: 8,
    kcal: 320,
    protein: 12,
    servings: '1',
    tags: ['breakfast'],
    method: ['Toast sourdough', 'Mash avocado with lemon and chili', 'Top with egg if desired'],
    ingredients: [
      { name: 'Sourdough', qty: '2 slices', aisle: 'Pantry' },
      { name: 'Avocado', qty: '1', aisle: 'Produce' },
      { name: 'Eggs', qty: '1', aisle: 'Meat + dairy' },
    ],
  },
  {
    name: 'Chickpea Salad Wrap',
    minutes: 15,
    kcal: 420,
    protein: 18,
    servings: '2',
    tags: ['lunch'],
    method: ['Mash chickpeas with tahini', 'Add cucumber and herbs', 'Wrap in tortilla'],
    ingredients: [
      { name: 'Chickpeas', qty: '1 can', aisle: 'Pantry' },
      { name: 'Tortillas', qty: '2', aisle: 'Pantry' },
      { name: 'Tahini', qty: '2 tbsp', aisle: 'Pantry' },
    ],
  },
  {
    name: 'Greek Yogurt Bowl',
    minutes: 5,
    kcal: 280,
    protein: 22,
    servings: '1',
    tags: ['breakfast', 'snack'],
    method: ['Scoop yogurt', 'Top with granola, honey, berries'],
    ingredients: [
      { name: 'Greek yogurt', qty: '1 cup', aisle: 'Meat + dairy' },
      { name: 'Granola', qty: '1/3 cup', aisle: 'Pantry' },
      { name: 'Berries', qty: '1/2 cup', aisle: 'Produce' },
    ],
  },
];

/** Ingredients for dinner recipes already created from the week seed. */
export const DINNER_INGREDIENTS = {
  'Rajma Chawal': [
    { name: 'Rajma, dry', qty: '1 cup', aisle: 'Pantry' },
    { name: 'Onion', qty: '1 large', aisle: 'Produce' },
    { name: 'Tomato', qty: '2', aisle: 'Produce' },
    { name: 'Basmati rice', qty: '1.5 cups', aisle: 'Pantry' },
  ],
  'Shawarma Bowls': [
    { name: 'Chicken thighs', qty: '1.5 lb', aisle: 'Meat + dairy' },
    { name: 'Onion', qty: '2 medium', aisle: 'Produce' },
    { name: 'Roma tomatoes', qty: '2', aisle: 'Produce' },
    { name: 'Yogurt', qty: '1/2 cup', aisle: 'Meat + dairy' },
  ],
  'Palak Paneer': [
    { name: 'Baby spinach', qty: '400 g', aisle: 'Produce' },
    { name: 'Paneer', qty: '400 g', aisle: 'Meat + dairy' },
    { name: 'Onion', qty: '1 medium', aisle: 'Produce' },
    { name: 'Green peas', qty: '1/2 cup', aisle: 'Frozen' },
  ],
  'Tandoori Chicken': [
    { name: 'Chicken thighs, bone-in', qty: '2 lb', aisle: 'Meat + dairy' },
    { name: 'Whole-milk yogurt', qty: '1 cup', aisle: 'Meat + dairy' },
    { name: 'Lemons', qty: '2', aisle: 'Produce' },
  ],
  'One-pot Lemon Orzo': [
    { name: 'Orzo', qty: '12 oz', aisle: 'Pantry' },
    { name: 'Lemons', qty: '2', aisle: 'Produce' },
    { name: 'Chicken broth', qty: '3 cups', aisle: 'Pantry' },
  ],
  'Dosa Night': [
    { name: 'Dosa batter', qty: '4 cups', aisle: 'Pantry' },
    { name: 'Potato filling', qty: '4', aisle: 'Produce' },
  ],
  'Slow-cooker Chili': [
    { name: 'Ground turkey', qty: '1 lb', aisle: 'Meat + dairy' },
    { name: 'Kidney beans', qty: '2 cans', aisle: 'Pantry' },
    { name: 'Onion', qty: '1', aisle: 'Produce' },
  ],
};

export { loadSql, hashPin, neon };
