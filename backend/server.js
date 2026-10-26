// =====================================================================
// Ha Molibetsane Community Library - Backend (ONE file: server.js)
//
// Express REST API + MySQL database.
//   /login                -> check a membership ID and password
//   /users                -> CRUD for users
//   /books                -> CRUD for books
//   /transactions         -> stock history + add / deduct / borrow / return
//   /borrow-records       -> who borrowed what (loan records)
//
// On the first start the server creates the database, the tables, a
// default admin account (ADMIN001 / admin123), so nothing has to be
// set up by hand except the MySQL login in the .env file.
// =====================================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "2706";
const DB_NAME = process.env.DB_NAME || "library_db";

// Library rules (the frontend shows the same numbers)
const MAX_LOANS = 3;
const LOAN_DAYS = 14;
const ONE_DAY = 24 * 60 * 60 * 1000;

let pool = null;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

// An error that carries an HTTP status code (400, 404, 409 ...)
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps an async route so errors go to the error middleware at the bottom.
function wrap(handler) {
  return function (req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Removes dashes and spaces from an ISBN so 978-0-45 and 978045 match.
function cleanIsbn(isbn) {
  return String(isbn).replace(/-/g, "").replace(/ /g, "").toLowerCase();
}

function isValidIsbn(isbn) {
  const digits = cleanIsbn(isbn);
  return /^[0-9]{9}[0-9x]$/.test(digits) || /^[0-9]{13}$/.test(digits);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function toIso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return new Date(value).toISOString();
}

function toIdText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

// Ids are numbers in MySQL, but the React app treats them as text,
// so every id is sent out as a string.
function mapUser(row) {
  return {
    id: toIdText(row.id),
    name: row.name,
    membershipId: row.membership_id,
    role: row.role,
    activeLoans: Number(row.active_loans || 0),
  };
}

function mapBook(row) {
  return {
    id: toIdText(row.id),
    title: row.title,
    author: row.author,
    genre: row.genre,
    isbn: row.isbn,
    quantity: row.quantity,
  };
}

function mapRecord(row) {
  return {
    id: toIdText(row.id),
    bookId: toIdText(row.book_id),
    bookTitle: row.book_title,
    userId: toIdText(row.user_id),
    userName: row.user_name,
    membershipId: row.membership_id,
    borrowedAt: toIso(row.borrowed_at),
    dueAt: toIso(row.due_at),
    returnedAt: toIso(row.returned_at),
  };
}

function mapTransaction(row) {
  return {
    id: toIdText(row.id),
    date: toIso(row.created_at),
    bookId: toIdText(row.book_id),
    bookTitle: row.book_title,
    type: row.type,
    quantity: row.quantity,
    stockAfter: row.stock_after,
    memberId: toIdText(row.member_id),
    memberName: row.member_name || "",
    recordedById: toIdText(row.recorded_by_id),
    recordedBy: row.recorded_by,
  };
}

// Turns "12" into 12. Returns null if it is not a proper id.
function parseId(value) {
  const number = Number(value);
  if (Number.isInteger(number) === false || number < 1) {
    return null;
  }
  return number;
}

// ---------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------
async function initDatabase() {
  // 1. Connect without a database so we can create it if it is missing.
  const firstConnection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  await firstConnection.query(
    "CREATE DATABASE IF NOT EXISTS `" + DB_NAME + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  );
  await firstConnection.end();

  // 2. The pool the whole app uses. timezone "Z" keeps every date in UTC.
  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
  });

  // 3. Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      membership_id VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','member') NOT NULL DEFAULT 'member'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      author VARCHAR(255) NOT NULL,
      genre VARCHAR(100) NOT NULL,
      isbn VARCHAR(30) NOT NULL,
      isbn_clean VARCHAR(30) NOT NULL UNIQUE,
      quantity INT NOT NULL DEFAULT 0,
      CHECK (quantity >= 0)
    )
  `);

  // Borrow records and the transaction log keep a text copy of the names,
  // so the history still reads correctly even after a book or user is deleted.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS borrow_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      book_id INT NULL,
      user_id INT NULL,
      book_title VARCHAR(255) NOT NULL,
      user_name VARCHAR(100) NOT NULL,
      membership_id VARCHAR(50) NOT NULL,
      borrowed_at DATETIME NOT NULL,
      due_at DATETIME NOT NULL,
      returned_at DATETIME NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      book_id INT NULL,
      book_title VARCHAR(255) NOT NULL,
      type VARCHAR(30) NOT NULL,
      quantity INT NOT NULL,
      stock_after INT NOT NULL,
      member_id INT NULL,
      member_name VARCHAR(100) NULL,
      recorded_by_id INT NULL,
      recorded_by VARCHAR(100) NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
      FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (recorded_by_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await ensureDefaultAdmin();
}

// The first time the app runs there are no users, so we make an admin.
// Without this nobody would be able to log in.
async function ensureDefaultAdmin() {
  const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.length === 0) {
    const hash = await bcrypt.hash("admin123", 10);
    await pool.query("INSERT INTO users (name, membership_id, password_hash, role) VALUES (?, ?, ?, 'admin')", [
      "Administrator",
      "ADMIN001",
      hash,
    ]);
    console.log("Default admin created: ADMIN001 / admin123");
  }
}

// Writes one line in the transaction log. "conn" can be the pool or a
// connection that is inside a database transaction.
async function logTransaction(conn, book, type, quantity, stockAfter, member, recorder, when) {
  let memberId = null;
  let memberName = null;
  if (member) {
    memberId = member.id;
    memberName = member.name;
  }
  await conn.query(
    `INSERT INTO transactions
      (book_id, book_title, type, quantity, stock_after, member_id, member_name, recorded_by_id, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [book.id, book.title, type, quantity, stockAfter, memberId, memberName, recorder.id, recorder.name, when]
  );
}

// Finds the person who pressed the button (for the "Recorded By" column).
async function findRecorder(conn, recordedById) {
  const id = parseId(recordedById);
  if (id !== null) {
    const [rows] = await conn.query("SELECT id, name FROM users WHERE id = ?", [id]);
    if (rows.length > 0) {
      return { id: rows[0].id, name: rows[0].name };
    }
  }
  return { id: null, name: "System" };
}

// ---------------------------------------------------------------------
// Express app + middleware
// ---------------------------------------------------------------------
const app = express();
app.use(cors()); // lets the React app (another port) call this API
app.use(express.json()); // reads JSON request bodies

app.get("/", function (req, res) {
  res.json({ message: "Ha Molibetsane Community Library API is running." });
});

// ---------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------
app.post(
  "/login",
  wrap(async function (req, res) {
    const membershipId = String(req.body.membershipId || "").trim();
    const password = String(req.body.password || "");

    if (membershipId === "" || password === "") {
      throw new HttpError(400, "Please enter your membership ID and password.");
    }

    const [rows] = await pool.query("SELECT * FROM users WHERE membership_id = ?", [membershipId]);
    if (rows.length === 0) {
      throw new HttpError(401, "The membership ID or password is not correct.");
    }

    const passwordMatches = await bcrypt.compare(password, rows[0].password_hash);
    if (passwordMatches === false) {
      throw new HttpError(401, "The membership ID or password is not correct.");
    }

    res.json(mapUser(rows[0]));
  })
);

// ---------------------------------------------------------------------
// USERS  (/users)
// ---------------------------------------------------------------------
const USER_SELECT = `
  SELECT u.*,
    (SELECT COUNT(*) FROM borrow_records r WHERE r.user_id = u.id AND r.returned_at IS NULL) AS active_loans
  FROM users u
`;

// Checks the data sent for a new or updated user. Returns the cleaned data.
function readUserBody(body, isNewUser) {
  const name = String(body.name || "").trim();
  const membershipId = String(body.membershipId || "").trim();
  const password = String(body.password || "");
  const role = body.role;

  if (name.length < 2) {
    throw new HttpError(400, "Please enter a name with at least 2 letters.");
  }
  if (membershipId === "") {
    throw new HttpError(400, "Please enter a membership ID.");
  }
  if (role !== "admin" && role !== "member") {
    throw new HttpError(400, "The role must be admin or member.");
  }
  if (isNewUser === true && password === "") {
    throw new HttpError(400, "Please enter a password.");
  }
  if (password !== "" && password.length < 6) {
    throw new HttpError(400, "The password must be at least 6 characters long.");
  }
  return { name: name, membershipId: membershipId, password: password, role: role };
}

async function countAdmins(conn) {
  const [rows] = await conn.query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
  return rows[0].total;
}

app.get(
  "/users",
  wrap(async function (req, res) {
    const [rows] = await pool.query(USER_SELECT + " ORDER BY u.id");
    res.json(rows.map(mapUser));
  })
);

app.get(
  "/users/:id",
  wrap(async function (req, res) {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(USER_SELECT + " WHERE u.id = ?", [id]);
    if (id === null || rows.length === 0) {
      throw new HttpError(404, "That user could not be found.");
    }
    res.json(mapUser(rows[0]));
  })
);

app.post(
  "/users",
  wrap(async function (req, res) {
    const data = readUserBody(req.body, true);

    const [existing] = await pool.query("SELECT id FROM users WHERE membership_id = ?", [data.membershipId]);
    if (existing.length > 0) {
      throw new HttpError(409, "That membership ID is already taken.");
    }

    const hash = await bcrypt.hash(data.password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, membership_id, password_hash, role) VALUES (?, ?, ?, ?)",
      [data.name, data.membershipId, hash, data.role]
    );

    const [rows] = await pool.query(USER_SELECT + " WHERE u.id = ?", [result.insertId]);
    res.status(201).json(mapUser(rows[0]));
  })
);

app.put(
  "/users/:id",
  wrap(async function (req, res) {
    const id = parseId(req.params.id);
    const data = readUserBody(req.body, false);

    const [found] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
    if (id === null || found.length === 0) {
      throw new HttpError(404, "That user could not be found.");
    }

    const [clash] = await pool.query("SELECT id FROM users WHERE membership_id = ? AND id <> ?", [
      data.membershipId,
      id,
    ]);
    if (clash.length > 0) {
      throw new HttpError(409, "That membership ID is already taken.");
    }

    // Do not allow the last admin to be changed into a normal member.
    if (found[0].role === "admin" && data.role !== "admin" && (await countAdmins(pool)) <= 1) {
      throw new HttpError(409, "There must always be at least one admin, so this role cannot be changed.");
    }

    if (data.password !== "") {
      const hash = await bcrypt.hash(data.password, 10);
      await pool.query("UPDATE users SET name = ?, membership_id = ?, role = ?, password_hash = ? WHERE id = ?", [
        data.name,
        data.membershipId,
        data.role,
        hash,
        id,
      ]);
    } else {
      await pool.query("UPDATE users SET name = ?, membership_id = ?, role = ? WHERE id = ?", [
        data.name,
        data.membershipId,
        data.role,
        id,
      ]);
    }

    // The history keeps a text copy of the name, so refresh those copies.
    await pool.query("UPDATE borrow_records SET user_name = ?, membership_id = ? WHERE user_id = ?", [
      data.name,
      data.membershipId,
      id,
    ]);
    await pool.query("UPDATE transactions SET member_name = ? WHERE member_id = ?", [data.name, id]);
    await pool.query("UPDATE transactions SET recorded_by = ? WHERE recorded_by_id = ?", [data.name, id]);

    const [rows] = await pool.query(USER_SELECT + " WHERE u.id = ?", [id]);
    res.json(mapUser(rows[0]));
  })
);

app.delete(
  "/users/:id",
  wrap(async function (req, res) {
    const id = parseId(req.params.id);
    const [found] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
    if (id === null || found.length === 0) {
      throw new HttpError(404, "That user could not be found.");
    }

    if (found[0].role === "admin" && (await countAdmins(pool)) <= 1) {
      throw new HttpError(409, "You cannot delete the last admin.");
    }

    const [loans] = await pool.query(
      "SELECT COUNT(*) AS total FROM borrow_records WHERE user_id = ? AND returned_at IS NULL",
      [id]
    );
    if (loans[0].total > 0) {
      throw new HttpError(
        409,
        found[0].name + " still has books on loan. They must be returned before the account is deleted."
      );
    }

    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ message: found[0].name + " was deleted." });
  })
);

// ---------------------------------------------------------------------
// BOOKS  (/books)
// ---------------------------------------------------------------------

// Checks the data sent for a new or updated book. Returns the cleaned data.
function readBookBody(body, isNewBook) {
  const title = String(body.title || "").trim();
  const author = String(body.author || "").trim();
  const genre = String(body.genre || "").trim();
  const isbn = String(body.isbn || "").trim();

  if (title === "") {
    throw new HttpError(400, "Please enter the book title.");
  }
  if (author === "") {
    throw new HttpError(400, "Please enter the author's name.");
  }
  if (genre === "") {
    throw new HttpError(400, "Please enter the genre.");
  }
  if (isbn === "") {
    throw new HttpError(400, "Please enter the ISBN.");
  }
  if (isValidIsbn(isbn) === false) {
    throw new HttpError(400, "An ISBN must have 10 or 13 digits (dashes are allowed).");
  }

  let quantity = 0;
  if (isNewBook === true) {
    quantity = Number(body.quantity);
    if (body.quantity === "" || body.quantity === undefined || Number.isInteger(quantity) === false) {
      throw new HttpError(400, "The quantity must be a whole number.");
    }
    if (quantity < 0) {
      throw new HttpError(400, "The quantity cannot be below 0.");
    }
  }

  return { title: title, author: author, genre: genre, isbn: isbn, quantity: quantity };
}

app.get(
  "/books",
  wrap(async function (req, res) {
    const [rows] = await pool.query("SELECT * FROM books ORDER BY id");
    res.json(rows.map(mapBook));
  })
);

app.get(
  "/books/:id",
  wrap(async function (req, res) {
    const id = parseId(req.params.id);
    const [rows] = await pool.query("SELECT * FROM books WHERE id = ?", [id]);
    if (id === null || rows.length === 0) {
      throw new HttpError(404, "That book could not be found.");
    }
    res.json(mapBook(rows[0]));
  })
);

app.post(
  "/books",
  wrap(async function (req, res) {
    const data = readBookBody(req.body, true);

    const [clash] = await pool.query("SELECT id FROM books WHERE isbn_clean = ?", [cleanIsbn(data.isbn)]);
    if (clash.length > 0) {
      throw new HttpError(409, "Another book already uses this ISBN.");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        "INSERT INTO books (title, author, genre, isbn, isbn_clean, quantity) VALUES (?, ?, ?, ?, ?, ?)",
        [data.title, data.author, data.genre, data.isbn, cleanIsbn(data.isbn), data.quantity]
      );

      // The opening stock goes in the history log like every other stock change.
      if (data.quantity > 0) {
        const recorder = await findRecorder(conn, req.body.recordedById);
        const newBook = { id: result.insertId, title: data.title };
        await logTransaction(conn, newBook, "Stock Added", data.quantity, data.quantity, null, recorder, new Date());
      }

      await conn.commit();

      const [rows] = await pool.query("SELECT * FROM books WHERE id = ?", [result.insertId]);
      res.status(201).json(mapBook(rows[0]));
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  })
);

// Updates the details of a book. The quantity is NOT changed here on purpose:
// stock only changes through a transaction so it is always in the history.
app.put(
  "/books/:id",
  wrap(async function (req, res) {
    const id = parseId(req.params.id);
    const data = readBookBody(req.body, false);

    const [found] = await pool.query("SELECT id FROM books WHERE id = ?", [id]);
    if (id === null || found.length === 0) {
      throw new HttpError(404, "That book could not be found.");
    }

    const [clash] = await pool.query("SELECT id FROM books WHERE isbn_clean = ? AND id <> ?", [
      cleanIsbn(data.isbn),
      id,
    ]);
    if (clash.length > 0) {
      throw new HttpError(409, "Another book already uses this ISBN.");
    }

    await pool.query("UPDATE books SET title = ?, author = ?, genre = ?, isbn = ?, isbn_clean = ? WHERE id = ?", [
      data.title,
      data.author,
      data.genre,
      data.isbn,
      cleanIsbn(data.isbn),
      id,
    ]);

    // Keep the text copies of the title in the history up to date.
    await pool.query("UPDATE borrow_records SET book_title = ? WHERE book_id = ?", [data.title, id]);
    await pool.query("UPDATE transactions SET book_title = ? WHERE book_id = ?", [data.title, id]);

    const [rows] = await pool.query("SELECT * FROM books WHERE id = ?", [id]);
    res.json(mapBook(rows[0]));
  })
);

app.delete(
  "/books/:id",
  wrap(async function (req, res) {
    const id = parseId(req.params.id);
    const [found] = await pool.query("SELECT * FROM books WHERE id = ?", [id]);
    if (id === null || found.length === 0) {
      throw new HttpError(404, "That book could not be found.");
    }

    // A book that is out on loan cannot be deleted, otherwise we lose track of it.
    const [loans] = await pool.query(
      "SELECT COUNT(*) AS total FROM borrow_records WHERE book_id = ? AND returned_at IS NULL",
      [id]
    );
    if (loans[0].total > 0) {
      throw new HttpError(
        409,
        "\"" + found[0].title + "\" cannot be deleted while " + loans[0].total + " copy/copies are on loan."
      );
    }

    await pool.query("DELETE FROM books WHERE id = ?", [id]);
    res.json({ message: "\"" + found[0].title + "\" was deleted." });
  })
);

// ---------------------------------------------------------------------
// BORROW RECORDS  (/borrow-records)
// ---------------------------------------------------------------------
app.get(
  "/borrow-records",
  wrap(async function (req, res) {
    let rows = [];
    if (req.query.userId !== undefined) {
      const userId = parseId(req.query.userId);
      [rows] = await pool.query("SELECT * FROM borrow_records WHERE user_id = ? ORDER BY borrowed_at DESC, id DESC", [
        userId,
      ]);
    } else {
      [rows] = await pool.query("SELECT * FROM borrow_records ORDER BY borrowed_at DESC, id DESC");
    }
    res.json(rows.map(mapRecord));
  })
);

// ---------------------------------------------------------------------
// TRANSACTIONS  (/transactions)
//   GET  -> the history log (newest first)
//   POST -> type is one of:
//     "add"     new stock arrived          { bookId, quantity }
//     "deduct"  copies leave the shelf     { bookId, quantity }
//     "borrow"  a member takes a book      { bookId, memberId, quantity }
//     "return"  a member brings a book     { recordId }
//   Every POST also needs { recordedById } (who pressed the button).
// ---------------------------------------------------------------------
app.get(
  "/transactions",
  wrap(async function (req, res) {
    const [rows] = await pool.query("SELECT * FROM transactions ORDER BY created_at DESC, id DESC");
    res.json(rows.map(mapTransaction));
  })
);

// Add stock or deduct stock (no member involved).
async function changeStock(conn, type, bookId, quantity, recorder) {
  const [rows] = await conn.query("SELECT * FROM books WHERE id = ? FOR UPDATE", [bookId]);
  if (rows.length === 0) {
    throw new HttpError(404, "That book could not be found.");
  }
  const book = rows[0];

  let newQuantity = 0;
  let typeLabel = "";

  if (type === "add") {
    newQuantity = book.quantity + quantity;
    typeLabel = "Stock Added";
  } else {
    if (quantity > book.quantity) {
      throw new HttpError(
        409,
        "Only " + book.quantity + " copies are in stock, so you cannot deduct " + quantity + "."
      );
    }
    newQuantity = book.quantity - quantity;
    typeLabel = "Stock Deducted";
  }

  await conn.query("UPDATE books SET quantity = ? WHERE id = ?", [newQuantity, book.id]);
  await logTransaction(conn, book, typeLabel, quantity, newQuantity, null, recorder, new Date());

  return {
    ok: true,
    message: typeLabel + ": " + quantity + " x \"" + book.title + "\". Copies now in stock: " + newQuantity + ".",
  };
}

// Gives a copy of a book to a member after checking the library rules.
async function borrowBook(conn, bookId, memberId, quantity, recorder) {
  const [bookRows] = await conn.query("SELECT * FROM books WHERE id = ? FOR UPDATE", [bookId]);
  if (bookRows.length === 0) {
    throw new HttpError(404, "That book could not be found.");
  }
  const book = bookRows[0];

  const [userRows] = await conn.query("SELECT * FROM users WHERE id = ?", [memberId]);
  if (userRows.length === 0) {
    throw new HttpError(404, "That member could not be found.");
  }
  const user = userRows[0];

  const [activeLoans] = await conn.query(
    "SELECT * FROM borrow_records WHERE user_id = ? AND returned_at IS NULL",
    [user.id]
  );

  const nowTime = Date.now();
  for (let i = 0; i < activeLoans.length; i = i + 1) {
    if (new Date(activeLoans[i].due_at).getTime() < nowTime) {
      throw new HttpError(409, "Borrowing is blocked because this account has an overdue book. Return it first.");
    }
  }

  if (quantity > 1) {
    throw new HttpError(409, "Only one copy of the same title can be borrowed at a time.");
  }

  for (let j = 0; j < activeLoans.length; j = j + 1) {
    if (activeLoans[j].book_id === book.id) {
      throw new HttpError(409, "This account already has a copy of \"" + book.title + "\" on loan.");
    }
  }

  if (activeLoans.length + quantity > MAX_LOANS) {
    throw new HttpError(409, "Borrowing limit reached. A member can hold at most " + MAX_LOANS + " books at a time.");
  }

  if (book.quantity < quantity) {
    throw new HttpError(409, "Sorry, no copies of \"" + book.title + "\" are available right now.");
  }

  const borrowedAt = new Date(nowTime);
  const dueAt = new Date(nowTime + LOAN_DAYS * ONE_DAY);

  await conn.query(
    `INSERT INTO borrow_records
      (book_id, user_id, book_title, user_name, membership_id, borrowed_at, due_at, returned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [book.id, user.id, book.title, user.name, user.membership_id, borrowedAt, dueAt]
  );

  const newQuantity = book.quantity - quantity;
  await conn.query("UPDATE books SET quantity = ? WHERE id = ?", [newQuantity, book.id]);
  await logTransaction(conn, book, "Book Borrowed", quantity, newQuantity, user, recorder, borrowedAt);

  return {
    ok: true,
    message: "\"" + book.title + "\" was borrowed by " + user.name + ". It is due back on " + formatDate(dueAt) + ".",
  };
}

// Takes a book back: stamps the return time and puts the copy back on the shelf.
async function returnBook(conn, recordId, recorder) {
  const [recordRows] = await conn.query("SELECT * FROM borrow_records WHERE id = ? FOR UPDATE", [recordId]);
  if (recordRows.length === 0 || recordRows[0].returned_at !== null) {
    throw new HttpError(409, "That loan could not be found or was already returned.");
  }
  const record = recordRows[0];

  const returnedAt = new Date();
  await conn.query("UPDATE borrow_records SET returned_at = ? WHERE id = ?", [returnedAt, record.id]);

  // The member who is returning the book (only the id and name are needed).
  const member = { id: record.user_id, name: record.user_name };

  if (record.book_id !== null) {
    const [bookRows] = await conn.query("SELECT * FROM books WHERE id = ? FOR UPDATE", [record.book_id]);
    if (bookRows.length > 0) {
      const book = bookRows[0];
      const newQuantity = book.quantity + 1;
      await conn.query("UPDATE books SET quantity = ? WHERE id = ?", [newQuantity, book.id]);
      await logTransaction(conn, book, "Book Returned", 1, newQuantity, member, recorder, returnedAt);
    }
  }

  let message = "\"" + record.book_title + "\" was returned. Thank you!";
  if (returnedAt.getTime() > new Date(record.due_at).getTime()) {
    message = "\"" + record.book_title + "\" was returned, but it was past its due date.";
  }
  return { ok: true, message: message };
}

app.post(
  "/transactions",
  wrap(async function (req, res) {
    const type = req.body.type;
    const quantity = Number(req.body.quantity);

    if (type !== "add" && type !== "deduct" && type !== "borrow" && type !== "return") {
      throw new HttpError(400, "The transaction type must be add, deduct, borrow or return.");
    }

    if (type !== "return") {
      if (Number.isInteger(quantity) === false || quantity < 1) {
        throw new HttpError(400, "The quantity must be a whole number of at least 1.");
      }
      if (parseId(req.body.bookId) === null) {
        throw new HttpError(400, "Please choose a book.");
      }
    }
    if (type === "borrow" && parseId(req.body.memberId) === null) {
      throw new HttpError(400, "Please choose a member.");
    }
    if (type === "return" && parseId(req.body.recordId) === null) {
      throw new HttpError(400, "That loan could not be found or was already returned.");
    }

    // Everything below happens inside ONE database transaction, so the stock
    // number, the loan record and the history line are saved together or not at all.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const recorder = await findRecorder(conn, req.body.recordedById);

      let result = null;
      if (type === "add" || type === "deduct") {
        result = await changeStock(conn, type, parseId(req.body.bookId), quantity, recorder);
      } else if (type === "borrow") {
        result = await borrowBook(conn, parseId(req.body.bookId), parseId(req.body.memberId), quantity, recorder);
      } else {
        result = await returnBook(conn, parseId(req.body.recordId), recorder);
      }

      await conn.commit();
      res.status(201).json(result);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  })
);

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------
app.use(function (req, res) {
  res.status(404).json({ message: "That address does not exist on this server." });
});

// Every error ends up here and is sent back as { message: "..." }.
app.use(function (error, req, res, next) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error && error.type === "entity.parse.failed") {
    res.status(400).json({ message: "The request body is not valid JSON." });
    return;
  }
  if (error && error.code === "ER_DUP_ENTRY") {
    res.status(409).json({ message: "That value is already used by another record." });
    return;
  }
  console.error(error);
  res.status(500).json({ message: "Something went wrong on the server." });
});

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------
initDatabase()
  .then(function () {
    app.listen(PORT, function () {
      console.log("Library API running on http://localhost:" + PORT);
    });
  })
  .catch(function (error) {
    console.error("Could not start the server. Is MySQL running and is the .env login correct?");
    console.error(error.message);
    process.exit(1);
  });
