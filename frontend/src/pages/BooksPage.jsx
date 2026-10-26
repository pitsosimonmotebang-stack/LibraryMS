import React, { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import Message from "../components/Message";
import BookForm from "../components/BookForm";
import BookList from "../components/BookList";
import { getBooks, addBook, updateBook, deleteBook } from "../api";

//Book Management page: add, update and delete books.
function BooksPage(props) {
  const [books, setBooks] = useState([]);
  const [bookToEdit, setBookToEdit] = useState(null);
  const [messageType, setMessageType] = useState("success");
  const [messageText, setMessageText] = useState("");

  function showMessage(type, text) {
    setMessageType(type);
    setMessageText(text);
  }

  //Asks the server for the book list.
  async function loadBooks() {
    try {
      const bookList = await getBooks();
      setBooks(bookList);
    } catch (error) {
      showMessage("error", error.message);
    }
  }

  //Load the list once when the page opens.
  useEffect(function () {
    loadBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearMessage = useCallback(function () {
    setMessageText("");
  }, []);

  //Called by the form when it passes validation.
  //It returns true if the server saved the book, so the form knows it can clear itself.
  async function handleSaveBook(bookData) {
    try {
      if (bookToEdit !== null) {
        await updateBook(bookToEdit.id, bookData);
        showMessage("success", "\"" + bookData.title + "\" was updated.");
        setBookToEdit(null);
      } else {
        await addBook(bookData, props.currentUser.id);
        showMessage("success", "\"" + bookData.title + "\" was added to the library.");
      }
      await loadBooks();
      return true;
    } catch (error) {
      showMessage("error", error.message);
      return false;
    }
  }

  //Called when the Update button on a row is pressed.
  function handleUpdateClick(book) {
    setBookToEdit(book);
    setMessageText("");
    //Scroll up so the person can see the form that was just filled in.
    window.scrollTo(0, 0);
  }

  async function handleDeleteClick(book) {
    const userSaidYes = window.confirm("Are you sure you want to delete \"" + book.title + "\"?");
    if (userSaidYes === false) {
      return;
    }

    try {
      //The server refuses if a copy of this book is still out on loan.
      await deleteBook(book.id);
      await loadBooks();

      //If the deleted book was being edited, stop editing it.
      if (bookToEdit !== null && bookToEdit.id === book.id) {
        setBookToEdit(null);
      }
      showMessage("success", "\"" + book.title + "\" was deleted.");
    } catch (error) {
      showMessage("error", error.message);
    }
  }

  function handleCancelEdit() {
    setBookToEdit(null);
  }

  return (
    <div>
      <PageHeader title="Book Management" />

      <Message type={messageType} text={messageText} onDismiss={clearMessage} />

      <BookForm bookToEdit={bookToEdit} books={books} onSave={handleSaveBook} onCancel={handleCancelEdit} />

      <div className="panel">
        <h2>All Books ({books.length})</h2>
        <BookList books={books} onUpdate={handleUpdateClick} onDelete={handleDeleteClick} />
      </div>
    </div>
  );
}

export default BooksPage;
