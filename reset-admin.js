
'use strict';

const readline = require('node:readline');
const { db, hashPassword } = require('./db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter new admin password: ', (password) => {
  try {
    if (password.length < 12) {
      console.log('Password must be at least 12 characters.');
      return;
    }

    const hash = hashPassword(password);

    const result = db.prepare(
      'UPDATE admins SET password_hash = ? WHERE username = ?'
    ).run(hash, 'admin');

    if (result.changes === 1) {
      console.log('Admin password reset successful!');
    } else {
      console.log('Admin account not found.');
    }
  } catch (error) {
    console.error('Reset failed:', error.message);
  } finally {
    db.close();
    rl.close();
  }
});
