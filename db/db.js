import mysql from "mysql2";
import dotenv from "dotenv";
dotenv.config();

// Create a connection to the database
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Pinging the database to keep the connection alive
setInterval(() => {
  pool.query("SELECT 1", (err) => {
    if (err) {
      console.error("Ping error:", err);
    } else {
      console.log("Database connected");
    }
  });
}, 60000); // 60 seconds

export default pool;
