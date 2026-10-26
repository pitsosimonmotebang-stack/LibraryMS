//Everything the React app says to the Express server is in this file.
//Each function uses the Fetch API and returns a promise.
//If the server answers with an error, the promise is rejected with an
//Error whose message is the sentence we can show on the screen.

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

const SESSION_KEY = "library_current_user_id";

//One place that does the fetch, reads the JSON and handles errors.
async function request(path, method, body) {
  const options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response = null;
  try {
    response = await fetch(API_URL + path, options);
  } catch (error) {
    throw new Error("Cannot reach the server. Please check that the backend is running.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (response.ok === false) {
    if (data && data.message) {
      throw new Error(data.message);
    }
    throw new Error("The server returned an error (" + response.status + ").");
  }
  return data;
}

//Login

export function login(membershipId, password) {
  return request("/login", "POST", { membershipId: membershipId, password: password });
}

//Login session (only the user id is kept, so a page refresh does not log you out)

export function saveSession(userId) {
  localStorage.setItem(SESSION_KEY, userId);
}

export async function loadSession() {
  const savedId = localStorage.getItem(SESSION_KEY);
  if (savedId === null) {
    return null;
  }
  try {
    return await request("/users/" + savedId, "GET");
  } catch (error) {
    //The account was deleted or the server is off: treat it as logged out.
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

//Users

export function getUsers() {
  return request("/users", "GET");
}

export function addUser(userData) {
  return request("/users", "POST", userData);
}

export function updateUser(id, userData) {
  return request("/users/" + id, "PUT", userData);
}

export function deleteUser(id) {
  return request("/users/" + id, "DELETE");
}

//Books

export function getBooks() {
  return request("/books", "GET");
}

export function addBook(bookData, recordedById) {
  const body = { ...bookData, recordedById: recordedById };
  return request("/books", "POST", body);
}

export function updateBook(id, bookData) {
  return request("/books/" + id, "PUT", bookData);
}

export function deleteBook(id) {
  return request("/books/" + id, "DELETE");
}

//Transactions and borrow records

export function getTransactions() {
  return request("/transactions", "GET");
}

//type is "add" (new stock arrived) or "deduct" (copies removed).
//The server changes the quantity AND writes a line in the history log.
export function recordTransaction(bookId, type, quantity, recordedById) {
  return request("/transactions", "POST", {
    type: type,
    bookId: bookId,
    quantity: quantity,
    recordedById: recordedById,
  });
}

//Gives a copy of a book to a member (the server checks the library rules).
export function borrowBooks(bookId, memberId, quantity, recordedById) {
  return request("/transactions", "POST", {
    type: "borrow",
    bookId: bookId,
    memberId: memberId,
    quantity: quantity,
    recordedById: recordedById,
  });
}

//Takes a book back.
export function returnBook(recordId, recordedById) {
  return request("/transactions", "POST", {
    type: "return",
    recordId: recordId,
    recordedById: recordedById,
  });
}

//Loan records. Pass a user id to get only that member's records.
export function getBorrowRecords(userId) {
  if (userId) {
    return request("/borrow-records?userId=" + userId, "GET");
  }
  return request("/borrow-records", "GET");
}
