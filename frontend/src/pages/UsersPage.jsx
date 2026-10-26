import React, { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import Message from "../components/Message";
import UserForm from "../components/UserForm";
import UserList from "../components/UserList";
import { getUsers, addUser, updateUser, deleteUser } from "../api";

//User Management page(admin only): add, update and delete users.
function UsersPage(props) {
  const [users, setUsers] = useState([]);
  const [userToEdit, setUserToEdit] = useState(null);
  const [messageType, setMessageType] = useState("success");
  const [messageText, setMessageText] = useState("");

  function showMessage(type, text) {
    setMessageType(type);
    setMessageText(text);
  }

  //Asks the server for the user list.
  async function loadUsers() {
    try {
      const userList = await getUsers();
      setUsers(userList);
    } catch (error) {
      showMessage("error", error.message);
    }
  }

  //Load the list once when the page opens.
  useEffect(function () {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  //useCallback keeps this function the same between renders, so the
  //message timer is not restarted every time something else changes.
  const clearMessage = useCallback(function () {
    setMessageText("");
  }, []);

  //Called by the form when it passes validation.
  //It returns true if the server saved the user, so the form knows it can clear itself.
  async function handleSaveUser(userData) {
    try {
      if (userToEdit !== null) {
        //The server refuses to turn the last admin into a normal member.
        const savedUser = await updateUser(userToEdit.id, userData);

        //If the admin edited their own account, refresh the logged in user too.
        if (userToEdit.id === props.currentUser.id) {
          props.onCurrentUserChange(savedUser);
        }

        showMessage("success", userData.name + " was updated.");
        setUserToEdit(null);
      } else {
        await addUser(userData);
        showMessage("success", userData.name + " was added.");
      }
      await loadUsers();
      return true;
    } catch (error) {
      showMessage("error", error.message);
      return false;
    }
  }

  function handleUpdateClick(user) {
    setUserToEdit(user);
    setMessageText("");
    window.scrollTo(0, 0);
  }

  async function handleDeleteClick(user) {
    if (user.id === props.currentUser.id) {
      showMessage("error", "You cannot delete the account you are logged in with.");
      return;
    }

    const userSaidYes = window.confirm("Are you sure you want to delete " + user.name + "?");
    if (userSaidYes === false) {
      return;
    }

    try {
      //The server refuses to delete the last admin or someone who still has books on loan.
      await deleteUser(user.id);
      await loadUsers();

      if (userToEdit !== null && userToEdit.id === user.id) {
        setUserToEdit(null);
      }
      showMessage("success", user.name + " was deleted.");
    } catch (error) {
      showMessage("error", error.message);
    }
  }

  function handleCancelEdit() {
    setUserToEdit(null);
  }

  //How many books each user has on loan right now (the server counts them).
  const loanCounts = {};
  for (let i = 0; i < users.length; i = i + 1) {
    loanCounts[users[i].id] = users[i].activeLoans;
  }

  return (
    <div>
      <PageHeader title="User Management" />

      <Message type={messageType} text={messageText} onDismiss={clearMessage} />

      <UserForm userToEdit={userToEdit} users={users} onSave={handleSaveUser} onCancel={handleCancelEdit} />

      <div className="panel">
        <h2>All Users ({users.length})</h2>
        <UserList
          users={users}
          currentUserId={props.currentUser.id}
          loanCounts={loanCounts}
          onUpdate={handleUpdateClick}
          onDelete={handleDeleteClick}
        />
      </div>
    </div>
  );
}

export default UsersPage;
