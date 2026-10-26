import React, { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import Message from "../components/Message";
import StockForm from "../components/StockForm";
import TransactionTable from "../components/TransactionTable";
import { getBooks, getUsers, getTransactions, recordTransaction, borrowBooks } from "../api";

//Transactions page: add stock, deduct stock and see the history log
function TransactionsPage(props) {
  const [books, setBooks] = useState([]);
  const [members, setMembers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [messageType, setMessageType] = useState("success");
  const [messageText, setMessageText] = useState("");

  //Loads the books and the history log from the server.
  async function loadBooksAndHistory() {
    const bookList = await getBooks();
    const history = await getTransactions();
    setBooks(bookList);
    setTransactions(history);
  }

  useEffect(function () {
    async function loadEverything() {
      try {
        await loadBooksAndHistory();

        //Only people with the member role can borrow books
        const allUsers = await getUsers();
        const justMembers = [];
        for (let i = 0; i < allUsers.length; i = i + 1) {
          if (allUsers[i].role === "member") {
            justMembers.push(allUsers[i]);
          }
        }
        setMembers(justMembers);
      } catch (error) {
        setMessageType("error");
        setMessageText(error.message);
      }
    }
    loadEverything();
  }, []);

  //useCallback keeps this function the same between renders, so the
  //message timer is not restarted every time something else changes.
  const clearMessage = useCallback(function () {
    setMessageText("");
  }, []);

  //Called by the stock form when it passes validation.
  //It returns true if it worked, so the form knows if it can clear itself.
  async function handleRecord(bookId, type, quantity, memberId) {
    let worked = false;

    try {
      let result = null;
      if (type === "deduct" && memberId !== "") {
        // A member was chosen, so this is a real checkout and a borrow record is made.
        result = await borrowBooks(bookId, memberId, quantity, props.currentUser.id);
      } else {
        result = await recordTransaction(bookId, type, quantity, props.currentUser.id);
      }
      setMessageType("success");
      setMessageText(result.message);
      worked = true;
    } catch (error) {
      setMessageType("error");
      setMessageText(error.message);
    }

    //Load the new numbers so the screen is up to date.
    try {
      await loadBooksAndHistory();
    } catch (error) {
      setMessageType("error");
      setMessageText(error.message);
    }

    return worked;
  }

  return (
    <div>
      <PageHeader title="Transactions" />

      <Message type={messageType} text={messageText} onDismiss={clearMessage} />

      <StockForm books={books} members={members} onRecord={handleRecord} />

      <div className="panel">
        <h2>Transaction History</h2>
        <TransactionTable transactions={transactions} />
      </div>
    </div>
  );
}

export default TransactionsPage;
