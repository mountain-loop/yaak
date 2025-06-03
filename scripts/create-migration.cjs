const fs = require('fs');
const path = require('path');
const readline = require('readline');
const slugify = require('slugify');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

async function createMigration() {
  try {
    const migrationName = await new Promise((resolve) => {
      rl.question('Enter migration name: ', resolve);
    });

    const timestamp = generateTimestamp();
    const fileName = `${timestamp}_${slugify(String(migrationName), { lower: true })}.sql`;
    const migrationsDir = path.join(__dirname, '../src-tauri/migrations');
    const filePath = path.join(migrationsDir, fileName);

    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    fs.writeFileSync(filePath, '-- Add migration SQL here\n');
    console.log(`Created migration file: ${fileName}`);
  } catch (error) {
    console.error('Error creating migration:', error);
  } finally {
    rl.close();
  }
}

createMigration().catch(console.error);
