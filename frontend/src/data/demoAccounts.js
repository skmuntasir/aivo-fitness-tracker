// Public demo accounts (also served by GET /api/demo/accounts). They live in an isolated sandbox on the server:
// demo users only see each other, and the demo admin can only manage demo users - nothing touches real data.
export const DEMO_ACCOUNTS = [
  { key: 'admin', label: 'Demo admin', short: 'Admin',  role: 'admin', email: 'admin@gmail.com', password: 'Admin@123' },
  { key: 'user1', label: 'Demo user 1', short: 'User 1', role: 'user',  email: 'user1@gmail.com', password: 'User@123' },
  { key: 'user2', label: 'Demo user 2', short: 'User 2', role: 'user',  email: 'user2@gmail.com', password: 'User@234' },
];
