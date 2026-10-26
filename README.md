# Ha Molibetsane Community Library – Library Management System

```
Molibetsane_Library_Management_System/
├── backend/            Express + MySQL REST API  (ONE file: server.js)
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── frontend/           React (Create React App) app
    ├── public/index.html
    ├── package.json
    └── src/
        ├── api.jsx     <- all Fetch API calls to the backend
        ├── App.jsx, helpers.jsx, UserContext.jsx, index.jsx, index.css
        ├── components/ (BookForm, UserForm, StockForm, BookList, ...)
        └── pages/      (Dashboard, Books, Transactions, Users, Records, My Books, Login)
```

## 1. Run the backend
Requires Node 18+ and a running MySQL (or MariaDB) server.

```bash
cd backend
npm install
cp .env.example .env      # then put your MySQL user/password in .env
npm start                 # http://localhost:5000
```
On the first start `server.js` creates the `library_db` database, all tables,
a default admin account (no sample data). Nothing else needs to be set up by hand.

## 2. Run the frontend
```bash
cd frontend
npm install
npm start                 # http://localhost:3000
```
If the backend is not on `http://localhost:5000`, copy `frontend/.env.example`
to `frontend/.env` and change `REACT_APP_API_URL`.

## Login (add members from the Users page)
| Role   | Membership ID | Password  |
|--------|---------------|-----------|
| Admin  | ADMIN001      | admin123  |

## API (all JSON)
| Method | Route | What it does |
|---|---|---|
| POST | `/login` | Check membership ID + password |
| GET / POST | `/users` | List users / add a user |
| GET / PUT / DELETE | `/users/:id` | One user: read / update / delete |
| GET / POST | `/books` | List books / add a book |
| GET / PUT / DELETE | `/books/:id` | One book: read / update details / delete |
| GET | `/transactions` | Full stock + borrowing history (newest first) |
| POST | `/transactions` | `type`: `add`, `deduct`, `borrow` or `return` |
| GET | `/borrow-records` | Loan records (`?userId=` for one member) |

Middleware: `express.json()` and `cors()`.

## Database tables
`users`, `books`, `borrow_records`, `transactions`. Stock changes, loan records
and history lines are saved together inside one SQL transaction.

## Rules enforced by the server
- Stock only changes through a transaction (add / deduct / borrow / return), so it is always in the history.
- Cannot deduct more copies than are in stock.
- A member can hold 3 books for 14 days, one copy per title, and cannot borrow while they have an overdue book.
- A book on loan, a user with books on loan, and the last admin cannot be deleted.
- ISBNs and membership IDs must be unique. Passwords are stored hashed (bcrypt).

Low stock (2 copies or fewer) is highlighted on the Dashboard, the book list and the cards.
