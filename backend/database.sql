-- =====================================================================
-- Ha Molibetsane Community Library - MySQL database
-- Run this in MySQL Workbench / phpMyAdmin / the mysql command line.
-- (server.js creates the same tables automatically, so this file is
--  only needed if you want to set up the database by hand.)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS library_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE library_db;

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  membership_id VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','member') NOT NULL DEFAULT 'member'
);

-- ---------- BOOKS ----------
CREATE TABLE IF NOT EXISTS books (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(255) NOT NULL,
  author     VARCHAR(255) NOT NULL,
  genre      VARCHAR(100) NOT NULL,
  isbn       VARCHAR(30)  NOT NULL,
  isbn_clean VARCHAR(30)  NOT NULL UNIQUE,   -- ISBN without dashes/spaces
  quantity   INT NOT NULL DEFAULT 0,
  CHECK (quantity >= 0)
);

-- ---------- BORROW RECORDS ----------
CREATE TABLE IF NOT EXISTS borrow_records (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  book_id       INT NULL,
  user_id       INT NULL,
  book_title    VARCHAR(255) NOT NULL,
  user_name     VARCHAR(100) NOT NULL,
  membership_id VARCHAR(50)  NOT NULL,
  borrowed_at   DATETIME NOT NULL,
  due_at        DATETIME NOT NULL,
  returned_at   DATETIME NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ---------- TRANSACTIONS (stock + borrowing history) ----------
CREATE TABLE IF NOT EXISTS transactions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  book_id        INT NULL,
  book_title     VARCHAR(255) NOT NULL,
  type           VARCHAR(30)  NOT NULL,  -- Stock Added, Stock Deducted, Book Borrowed, Book Returned
  quantity       INT NOT NULL,
  stock_after    INT NOT NULL,
  member_id      INT NULL,
  member_name    VARCHAR(100) NULL,
  recorded_by_id INT NULL,
  recorded_by    VARCHAR(100) NOT NULL,
  created_at     DATETIME NOT NULL,
  FOREIGN KEY (book_id)        REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY (member_id)      REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (recorded_by_id) REFERENCES users(id) ON DELETE SET NULL
);

-- =====================================================================
-- STARTER DATA: only the admin login.   ADMIN001 / admin123
-- =====================================================================
INSERT INTO users (name, membership_id, password_hash, role) VALUES
  ('Administrator', 'ADMIN001', '$2a$10$L/eI.NNCc7q4cg8xXU3kSe.pBhDAEwg3PbA2LF1W5myDyrx936vZ2', 'admin');

-- =====================================================================
-- HANDY QUERIES
-- =====================================================================
-- Low stock books (2 copies or fewer)
-- SELECT title, quantity FROM books WHERE quantity <= 2 ORDER BY quantity;

-- Books currently on loan
-- SELECT book_title, user_name, borrowed_at, due_at FROM borrow_records WHERE returned_at IS NULL;

-- Overdue books
-- SELECT book_title, user_name, due_at FROM borrow_records WHERE returned_at IS NULL AND due_at < NOW();

-- Full history, newest first
-- SELECT created_at, book_title, type, quantity, stock_after, recorded_by FROM transactions ORDER BY created_at DESC;
